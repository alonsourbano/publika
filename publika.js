/* global moment, nunjucks */

// Based on code from Sami Mäkinen (https://github.com/ZakarFin)

const NOTIFICATION = {
  BIKE: {
    STATION: {
      FETCH: "FETCH_BIKE_STATION",
      REJECT: "REJECT_BIKE_STATION",
      RESOLVE: "RESOLVE_BIKE_STATION"
    }
  },
  NOTIFICATION: { RESOLVE: "NOTIFICATION" },
  READY: {
    RESOLVE: "READY",
    INIT: "INIT",
    CORE_INIT: "CORE_INIT",
    FETCH_BATCH: "FETCH_BATCH"
  },
  SEARCH_STOP: {
    FETCH: "SEARCH_STOP",
    REJECT: "REJECT_SEARCH_STOP",
    RESOLVE: "RESOLVE_SEARCH_STOP"
  },
  STOP_STOPTIMES: {
    FETCH: "FETCH_STOP_STOPTIMES",
    REJECT: "REJECT_STOP_STOPTIMES",
    RESOLVE: "RESOLVE_STOP_STOPTIMES"
  },
  WATCHER: {
    AWAKE: "AWAKE",
    FEED: "FEED",
    WAKE_UP: "WAKE_UP"
  }
};

Module.register("publika", {
  defaults: {
    feed: "HSL",
    stops: [],
    stopTimesCount: 5,
    theme: "color",
    fullHeadsign: false,
    headsignViaTo: false,
    digiTransitApiKey: undefined,
    debug: false
  },

  timeFormat: config.timeFormat === 24 ? "HH:mm" : "h:mm a",
  instances: [],
  apiKeyDeadLine: undefined,
  updateAgeLimitSeconds: 60,

  notificationReceived: function (notification, payload, sender) {
    if (notification === "ALL_MODULES_STARTED") {
      return this.onAllModulesStarted();
    }
    if (notification === "DOM_OBJECTS_CREATED") {
      return;
    }
    if (notification === "MODULE_DOM_CREATED") {
      return;
    }
    if (sender?.name === "clock") {
      return;
    }
    if (sender?.name === "publika") {
      return;
    }

    Log.warn(`Unhandled notification ${notification}`, payload, sender);
  },

  processStopStoptimesNotification: function (instance, notification, payload) {
    const { data, ...stop } = payload;

    if (instance.backgroundTasks.remainingTimeWatcher === undefined) {
      Log.log(
        `Starting ${this.name}::${this.identifier}::remainingTimeWatcher`
      );
      instance.backgroundTasks.remainingTimeWatcher = setInterval(() => {
        this.watchRemainingTime();
      }, instance.intervals.update.remainingTimeWatcher);
    }

    if (instance.backgroundTasks.updateStatusWatcher === undefined) {
      Log.log(`Starting ${this.name}::${this.identifier}::updateStatusWatcher`);
      instance.backgroundTasks.updateStatusWatcher = setInterval(() => {
        this.watchUpdateStatus();
      }, instance.intervals.update.updateStatusWatcher);
    }

    if (notification === NOTIFICATION.STOP_STOPTIMES.RESOLVE) {
      if (this.validateStopRules(stop)) {
        setTimeout(() => {
          this.sendInstanceSocketNotification(
            NOTIFICATION.STOP_STOPTIMES.FETCH,
            stop
          );
        }, this.getNextInterval(instance.intervals.update.default));
      }
      return this.updateStoptime(instance, stop, data);
    }

    if (notification === NOTIFICATION.STOP_STOPTIMES.REJECT) {
      setTimeout(() => {
        this.sendInstanceSocketNotification(
          NOTIFICATION.STOP_STOPTIMES.FETCH,
          stop
        );
      }, this.getNextInterval(instance.intervals.retry));
      return this.rejectStoptime(instance, stop.id);
    }

    this.rejectSocketNotification(notification, payload);
  },

  processNotificationNotification: function (instance, notification, payload) {
    const alertModuleAvailable = MM.getModules().some(
      (module) => module.name === "alert" && !module.hidden
    );

    if (notification === NOTIFICATION.NOTIFICATION.RESOLVE) {
      if (alertModuleAvailable) {
        return this.sendNotification("SHOW_ALERT", payload);
      }

      return this.pushNotification(instance, payload);
    }

    this.rejectSocketNotification(notification, payload);
  },

  pushNotification: function (instance, notification) {
    instance.notifications.push(notification);
    if (instance.backgroundTasks.notificationWatcher === undefined) {
      Log.log(`Starting ${this.name}::${this.identifier}::notificationWatcher`);
      instance.backgroundTasks.notificationWatcher = setInterval(() => {
        this.watchNotifications();
      }, instance.intervals.update.notificationWatcher);
    }
    return this.updateDom();
  },

  processReadyNotification: function (instance, notification, payload) {
    if (notification === NOTIFICATION.READY.RESOLVE) {
      const batch = instance.stops
        .filter((stop) => !stop.disabled)
        .filter(this.validateStopRules)
        .map((stop) => {
          if (stop.type === "cluster") {
            this.notify(this.translate("CLUSTER"));
            return undefined;
          }
          if (stop.search) {
            return {
              notification: NOTIFICATION.SEARCH_STOP.FETCH,
              payload: { id: stop.id, search: stop.search }
            };
          }
          const { id, stopTimesCount, type, minutesFrom } = stop;
          if (type === "bikeStation") {
            if (this.isBikeSeason()) {
              return {
                notification: NOTIFICATION.BIKE.STATION.FETCH,
                payload: { id, type }
              };
            }
            this.notify(this.translate("OFF_SEASON_DESC"));
            return undefined;
          }
          return {
            notification: NOTIFICATION.STOP_STOPTIMES.FETCH,
            payload: {
              id: id ?? stop,
              stopTimesCount: stopTimesCount ?? instance.config.stopTimesCount,
              type,
              minutesFrom
            }
          };
        })
        .filter((item) => item);
      return this.sendInstanceSocketNotification(
        NOTIFICATION.READY.FETCH_BATCH,
        batch
      );
    }

    this.rejectSocketNotification(notification, payload);
  },

  processSearchStopNotification: function (instance, notification, payload) {
    const { data, ...stop } = payload;

    if (notification === NOTIFICATION.SEARCH_STOP.RESOLVE) {
      return this.updateSearchStop(instance, stop, data);
    }

    if (notification === NOTIFICATION.SEARCH_STOP.REJECT) {
      setTimeout(() => {
        this.sendInstanceSocketNotification(
          NOTIFICATION.SEARCH_STOP.FETCH,
          stop
        );
      }, this.getNextInterval(instance.intervals.retry));
      return this.rejectStoptime(instance, stop.id);
    }

    this.rejectSocketNotification(notification, payload);
  },

  processWatcherNotification: function (instance, notification, payload) {
    if (notification === NOTIFICATION.WATCHER.AWAKE) {
      return this.sendInitNotification(instance);
    }

    if (notification === NOTIFICATION.WATCHER.FEED) {
      return this.sendCoreInitNotification(instance);
    }

    this.rejectSocketNotification(notification, payload);
  },

  processBikeStationNotification: function (instance, notification, payload) {
    const { data, ...stop } = payload;

    if (notification === NOTIFICATION.BIKE.STATION.RESOLVE) {
      if (this.validateStopRules(stop) && this.isBikeSeason()) {
        setTimeout(() => {
          this.sendInstanceSocketNotification(
            NOTIFICATION.BIKE.STATION.FETCH,
            stop
          );
        }, this.getNextInterval(instance.intervals.update.bikeStation));
      }
      return this.updateStoptime(instance, stop, data);
    }

    if (notification === NOTIFICATION.BIKE.STATION.REJECT) {
      setTimeout(() => {
        this.sendInstanceSocketNotification(
          NOTIFICATION.BIKE.STATION.FETCH,
          stop
        );
      }, this.getNextInterval(instance.intervals.retry));
      return this.rejectStoptime(instance, stop.id);
    }

    this.rejectSocketNotification(notification, payload);
  },

  checkSocketNotification: function (origin, target) {
    return Object.keys(target).some((item) => target[item] === origin);
  },

  socketNotificationReceived: function (notification, payload) {
    const [instanceId, notificationType] = notification.split("::");

    if (instanceId !== this.identifier) {
      return;
    }

    const instance = this.getInstance();

    if (instance.config.debug) {
      Log.log(notification, payload);
    }

    if (
      this.checkSocketNotification(
        notificationType,
        NOTIFICATION.STOP_STOPTIMES
      )
    ) {
      return this.processStopStoptimesNotification(
        instance,
        notificationType,
        payload
      );
    }
    if (
      this.checkSocketNotification(notificationType, NOTIFICATION.NOTIFICATION)
    ) {
      return this.processNotificationNotification(
        instance,
        notificationType,
        payload
      );
    }
    if (this.checkSocketNotification(notificationType, NOTIFICATION.READY)) {
      return this.processReadyNotification(instance, notificationType, payload);
    }
    if (this.checkSocketNotification(notificationType, NOTIFICATION.WATCHER)) {
      return this.processWatcherNotification(
        instance,
        notificationType,
        payload
      );
    }
    if (
      this.checkSocketNotification(notificationType, NOTIFICATION.SEARCH_STOP)
    ) {
      return this.processSearchStopNotification(
        instance,
        notificationType,
        payload
      );
    }
    if (
      this.checkSocketNotification(notificationType, NOTIFICATION.BIKE.STATION)
    ) {
      return this.processBikeStationNotification(
        instance,
        notificationType,
        payload
      );
    }

    this.rejectSocketNotification(notification, payload);
  },

  rejectSocketNotification: function (notification, payload) {
    const errorMessage = `Unhandled socket notification ${notification}`;
    Log.error(errorMessage, payload);
  },

  getNextInterval: function (interval) {
    return Array.isArray(interval)
      ? interval.length === 1
        ? interval.at(0)
        : interval.shift()
      : interval;
  },

  watchRemainingTime: function () {
    const instance = this.getInstance();
    const remainingTimes = instance.stops
      .map((stop) =>
        Array.isArray(stop.stoptimes)
          ? stop.stoptimes
            .filter((stoptime) => stoptime.remainingTime >= 0)
            .map((stoptime) => (stoptime.remainingTime >= 0 ? 1 : 0))
            .reduce((p, c) => p + c, 0)
          : 0
      )
      .reduce((p, c) => p + c, 0);
    if (remainingTimes === 0) {
      clearInterval(instance.backgroundTasks.remainingTimeWatcher);
      instance.backgroundTasks.remainingTimeWatcher = undefined;
      Log.warn(
        `Shutting down ${this.name}::${this.identifier}::remainingTimeWatcher`
      );
      return;
    }
    var requiresDomUpdate = false;
    instance.stops.forEach((stop) => {
      if (!Array.isArray(stop.stoptimes)) {
        return;
      }
      stop.stoptimes
        .filter((stoptime) => stoptime.remainingTime >= 0)
        .forEach((stoptime) => {
          const time = moment(stoptime.time);
          const previousRemainingTime = stoptime.remainingTime;
          stoptime.remainingTime = Math.round(
            moment.duration(time.diff(moment())).asMinutes()
          );
          if (
            previousRemainingTime !== stoptime.remainingTime &&
            stoptime.remainingTime <= 10
          ) {
            if (instance.config.debug) {
              Log.log(
                `${this.name}::${this.identifier
                }::watchRemainingTime updated remaining time to ${stoptime.remainingTime
                } for service ${stoptime.line} departing from ${stop.meta.name
                } at ${time.format(this.timeFormat)}`
              );
            }
            requiresDomUpdate = true;
          }
        });
    });
    Log.warn("Checkinf if requires DOM update...");
    if (requiresDomUpdate) {
      Log.warn("Updating DOM");
      this.updateDom();
    }
  },

  watchUpdateStatus: function () {
    const instance = this.getInstance();
    const remaining = instance.stops.filter((stop) => stop.updateAge !== true);
    if (remaining.length === 0) {
      clearInterval(instance.backgroundTasks.updateStatusWatcher);
      instance.backgroundTasks.updateStatusWatcher = undefined;
      Log.warn(
        `Shutting down ${this.name}::${this.identifier}::updateStatusWatcher`
      );
    }
    var shouldUpdateDom = false;
    instance.stops
      .filter((stop) => stop.updateAge !== true)
      .forEach((stop) => {
        stop.updateAge = Math.round(
          moment.duration(moment().diff(stop.updateTime)).asSeconds()
        );
        if (stop.updateAge > this.updateAgeLimitSeconds) {
          if (instance.config.debug) {
            Log.log(
              `${this.name}::${this.identifier
              }::watchUpdateStatus updated age for stop ${stop.meta.name ?? stop.id
              }`
            );
          }
          stop.updateAge = true;
          if (!shouldUpdateDom) {
            shouldUpdateDom = true;
          }
        }
      });
    if (shouldUpdateDom) {
      this.updateDom();
    }
  },

  watchSocket: function () {
    const instance = this.getInstance();
    const lastUpdate = instance.stops
      .map((stop) => stop.updateTime)
      .reduce((p, c) => (p !== undefined && p.isAfter(c) ? p : c), undefined);
    if (
      lastUpdate.isBefore(moment().subtract(this.updateAgeLimit, "seconds"))
    ) {
      this.sendInstanceSocketNotification(
        NOTIFICATION.WATCHER.WAKE_UP,
        undefined
      );
    }
  },

  watchNotifications: function () {
    const instance = this.getInstance();
    if (!instance.notifications || !instance.notifications.length) {
      clearInterval(instance.backgroundTasks.notificationWatcher);
      instance.backgroundTasks.notificationWatcher = undefined;
      Log.warn(
        `Shutting down ${this.name}::${this.identifier}::notificationWatcher`
      );
      return;
    }
    const [notification, ...rest] = instance.notifications;
    const elapsed = moment().diff(notification.printedTime, "seconds");
    const duration = moment.duration(notification.timer).asSeconds();
    if (elapsed >= duration) {
      instance.notifications = instance.notifications.filter(
        (item) => item.id !== notification.id
      );
      return this.updateDom();
    }
  },

  onAllModulesStarted: function () {
    const modules = MM.getModules().filter(
      (module) => module.name === this.name
    );
    if (modules.length > 1) {
      const cores = modules.filter((module) => module.config.core);
      if (cores.length !== 1) {
        this.instances = MM.getModules()
          .filter(
            (module) =>
              module.name === this.name && module.identifier === this.identifier
          )
          .map((module) => ({
            id: module.identifier,
            coreError:
              cores.length === 0 ? "CORE_ERROR_NONE" : "CORE_ERROR_MULTIPLE"
          }));
        return;
      }
    }
    this.instances = MM.getModules()
      .filter(
        (module) =>
          module.name === this.name && module.identifier === this.identifier
      )
      .map((module) => ({
        id: module.identifier,
        backgroundTasks: {
          notificationWatcher: undefined,
          remainingTimeWatcher: undefined,
          socketWatcher: undefined,
          updateStatusWatcher: undefined
        },
        config: { ...this.defaults, ...module.config },
        core: modules.length === 1 || module.config.core,
        intervals: {
          update: {
            notificationWatcher: 1 * 1000,
            remainingTimeWatcher: 5 * 1000,
            socketWatcher: 100 * 1000,
            updateStatusWatcher: 5 * 1000,
            bikeStation: 45 * 1000,
            default: 45 * 1000
          },
          retry: [1 * 1000, 5 * 1000, 10 * 1000, 20 * 1000, 45 * 1000]
        },
        notifications: [],
        position: module.data.position,
        sentNotifications: [],
        stops: module.config.stops
          .filter((stop) => !stop.disabled)
          .filter(this.validateStopRules)
          .map((stop) => ({
            ...stop,
            id: stop.id ?? stop,
            stoptimes: { empty: true }
          }))
      }))
      .map((instance) => ({
        ...instance,
        config: {
          ...instance.config,
          stops: instance.config.stops.map((stop) =>
            stop.id ? stop : { id: stop }
          )
        }
      }));
    const instance = this.getInstance();
    if (
      !this.isBikeSeason() &&
      instance.stops?.some((stop) => stop.type === "bikeStation")
    ) {
      instance.stops = instance.stops.reduce(
        (p, c) =>
          c.type === "bikeStation" &&
            p.some((item) => item.type === "bikeStation")
            ? p
            : p.concat(c),
        []
      );
    }
    if (instance.config?.theme) {
      this.loadStyles(() => {
        Log.log("Styles reloaded");
      });
    }
    this.sendInitNotification(instance);
    if (
      instance.core &&
      instance.id === this.identifier &&
      !instance.config.digiTransitApiKey
    ) {
      this.apiKeyDeadLine = moment("20230403", "YYYYMMDD");
      this.notify(
        `Starting from ${this.apiKeyDeadLine.format(
          "LL"
        )}, the use of the Digitransit APIs will require registration and use of API keys. Registration can be done at the Digitransit API portal.`
      );
    }
    if (instance.backgroundTasks.socketWatcher === undefined) {
      Log.log(`Starting ${this.name}::${this.identifier}::socketWatcher`);
      instance.backgroundTasks.socketWatcher = setInterval(() => {
        this.watchSocket();
      }, instance.intervals.update.socketWatcher);
    }
  },

  getInstance: function () {
    return this.instances.find((instance) => instance.id === this.identifier);
  },

  sendInitNotification: function (instance) {
    this.sendCoreInitNotification(instance);
    this.sendInstanceSocketNotification(NOTIFICATION.READY.INIT, {
      debug: instance.config.debug,
      feed: instance.config.feed
    });
  },

  sendCoreInitNotification: function (instance) {
    if (instance.core && instance.id === this.identifier) {
      this.sendInstanceSocketNotification(NOTIFICATION.READY.CORE_INIT, {
        digiTransit: {
          subscriptionKey: instance.config.digiTransitApiKey
        }
      });
    }
  },

  sendInstanceSocketNotification: function (notification, payload) {
    this.sendSocketNotification(`${this.identifier}::${notification}`, payload);
  },

  notify: function (message) {
    const instance = this.getInstance();
    const notification = {
      type: "notification",
      title: `Module ${this.name}`,
      message,
      timer: moment.duration(5, "seconds").asMilliseconds()
    };

    if (
      instance.sentNotifications.some(
        (item) => JSON.stringify(item) === JSON.stringify(notification)
      )
    ) {
      return;
    }

    if (instance.sentNotifications.length === 0) {
      notification.timer *= 2;
    }

    this.sendInstanceSocketNotification(
      NOTIFICATION.NOTIFICATION.RESOLVE,
      notification
    );
    instance.sentNotifications.push(notification);
  },

  updateStoptime: function (instance, stop, data) {
    const index = instance.stops.findIndex(
      (stoptime) => stoptime.id === stop.id
    );
    const configIndex = instance.config.stops.findIndex(
      (stoptime) => stoptime.id === stop.id
    );
    const {
      alerts,
      bikeRentalStation,
      stops,
      stopsLength,
      stopTimes,
      ...meta
    } = data;
    instance.stops[index].stoptimes = stopTimes;
    instance.stops[index].config = instance.config.stops[configIndex];
    instance.stops[index].stopsLength = stopsLength;
    instance.stops[index].meta = meta;
    instance.stops[index].alerts = alerts;
    instance.stops[index].bikeRentalStation = bikeRentalStation;
    instance.stops[index].updateTime = moment();
    instance.stops[index].updateAge = 0;
    if (instance.stops[index].config?.eta) {
      if (
        instance.stops[index].config.type === "stop" ||
        instance.stops[index].config.type === undefined
      ) {
        var destination = undefined;
        instance.stops[index].stoptimes.forEach((stoptime) => {
          stoptime.eta = stoptime.trip.stoptimes.find(
            (item) =>
              parseInt(item.stop.gtfsId.split(":").at(1)) ===
              instance.stops[index].config.eta
          );
          if (stoptime.eta?.stop?.name && destination === undefined) {
            destination = stoptime.eta.stop.name;
            instance.stops[index].destination = destination;
          }
          stoptime.trip.stoptimes = undefined;
        });
      } else {
        this.notify(this.translate("ETA_NO_STOP"));
      }
    }
    this.updateDom();
  },

  updateSearchStop: function (instance, stop, data) {
    const index = instance.stops.findIndex(
      (stoptime) => stoptime.id === stop.id
    );
    const configIndex = instance.config.stops.findIndex(
      (stoptime) => stoptime.id === stop.id
    );
    const { stops, ...meta } = data;
    instance.stops[index].meta = meta;
    instance.stops[index].searchStops = stops;
    instance.stops[index].updateTime = moment();
    instance.stops[index].updateAge = 0;
    this.updateDom();
  },

  rejectStoptime: function (instance, id) {
    const index = instance.stops.findIndex((stoptime) => stoptime.id === id);
    instance.stops[index].stoptimes = { error: true };
    this.updateDom();
  },

  validateStopRules: function (stop) {
    const validateRule = (rule) => {
      if (rule.days) {
        const visible = rule.days.includes(moment().day());
        if (!visible) {
          return false;
        }
      }
      if (rule.startTime) {
        const start = moment(rule.startTime, "HH:mm");
        if (!start.isValid()) {
          Log.error("Invalid date rule definition", rule.startTime);
          return true;
        }
        const visible = start <= moment();
        if (!visible) {
          return false;
        }
      }
      if (rule.endTime) {
        const end = moment(rule.endTime, "HH:mm");
        if (!end.isValid()) {
          Log.error("Invalid date rule definition", rule.endTime);
          return true;
        }
        const visible = end >= moment();
        if (!visible) {
          return false;
        }
      }
      return true;
    };
    if (!stop.rules) {
      return true;
    }
    try {
      for (const rule of stop.rules) {
        const valid = validateRule(rule);
        if (valid) {
          return true;
        }
      }
      return false;
    } catch (error) {
      Log.error(error);
    }

    return true;
  },

  getTranslations: function () {
    return {
      en: "translations/en.json",
      fi: "translations/fi.json",
      sv: "translations/sv.json"
    };
  },

  getScripts: function () {
    return ["moment.js", "moment-timezone.js"];
  },

  getStyles: function () {
    const instance = this.getInstance();
    if (instance) {
      if (instance.config?.theme) {
        return [this.file(`css/${this.name}.${instance.config.theme}.css`)];
      }
      return [];
    }

    return ["font-awesome.css", this.file(`css/${this.name}.base.css`)];
  },

  loadStyles: function (callback) {
    this.loadDependencies("getStyles", callback);
  },

  getTemplateObject: function () {
    const isBar = (position) =>
      [
        "bottom_bar",
        "fullscreen_above",
        "fullscreen_below",
        "lower_third",
        "middle_center",
        "top_bar",
        "upper_third"
      ].includes(position);
    const { config, coreError, notifications, position, stops } =
      this.getInstance();
    const baseTemplate = isBar(position) ? "bar" : "default";
    if (coreError) {
      return [`${baseTemplate}/error`, { message: this.translate(coreError) }];
    }
    if (!config?.stops?.length) {
      return [
        `${baseTemplate}/error`,
        { message: this.translate("SETUP_MODULE") }
      ];
    }
    if (
      isBar(position) &&
      config.stops.length &&
      config.stops.at(0).type !== undefined &&
      config.stops.at(0).type !== "stop" &&
      config.stops.at(0).type !== "station"
    ) {
      return [
        `${baseTemplate}/error`,
        { message: this.translate("BAR_WRONG_TYPE") }
      ];
    }

    return [
      `${baseTemplate}/normal`,
      {
        config: {
          isBar: isBar(position),
          debug: config.debug,
          feed: config.feed,
          theme: config.theme
        },
        data: {
          notifications,
          stops
        },
        defaults: { colspan: 4 },
        functions: {
          getAgedStyle: (stop) => this.getAgedStyle(stop),
          getHeadsignAlerts: (stop, stoptime) =>
            stop.alerts
              .map((alert) => ({
                ...alert,
                startTime: moment(alert.startTime),
                endTime: moment(alert.endTime)
              }))
              .filter(
                (alert) =>
                  alert.trip?.gtfsId === stoptime.trip?.gtfsId ||
                  alert.route?.gtfsId === stoptime.trip?.route?.gtfsId
              )
              .filter((alert) =>
                moment().isBetween(alert.startTime, alert.endTime)
              )
              .reduce(
                (p, c) =>
                  p.some((item) => c.alertSeverityLevel === item)
                    ? p
                    : p.concat(c.alertSeverityLevel),
                []
              ),
          getHeadsignAlertsFull: (stop, stoptime) =>
            stop.alerts
              .map((alert) => ({
                ...alert,
                startTime: moment(alert.startTime),
                endTime: moment(alert.endTime)
              }))
              .filter(
                (alert) =>
                  alert.trip?.gtfsId === stoptime.trip?.gtfsId ||
                  alert.route?.gtfsId === stoptime.trip?.route?.gtfsId
              )
              .filter((alert) =>
                moment().isBetween(alert.startTime, alert.endTime)
              )
              .map((alert) => ({
                id: `${alert.alertSeverityLevel}:${alert.alertEffect}`,
                icon: alert.alertSeverityLevel,
                alertSeverityLevel: alert.alertSeverityLevel,
                effect: this.translate(alert.alertEffect),
                startTime: alert.startTime,
                endTime: alert.endTime,
                text: this.getAlertTranslation(alert, "alertHeaderText"),
                description: this.getAlertTranslation(
                  alert,
                  "alertDescriptionText"
                )
              }))
              .reduce(
                (p, c) =>
                  p.some((item) => c.id === item.id) ? p : p.concat(c),
                []
              ),
          getHeadsignText: (stop, stoptime) => {
            if (
              !stoptime.headsign &&
              !stoptime.trip.tripHeadsign &&
              !stoptime.trip.route.longName
            ) {
              return "";
            }
            const fullHeadsign =
              typeof stop.fullHeadsign === "undefined"
                ? config.fullHeadsign
                : stop.fullHeadsign;
            const headsignViaTo =
              typeof stop.headsignViaTo === "undefined"
                ? config.headsignViaTo
                : stop.headsignViaTo;
            const headsign =
              stoptime.headsign ||
              stoptime.trip.tripHeadsign ||
              stoptime.trip.route.longName ||
              "";
            const [to, via] = (
              headsign.startsWith(`${stoptime.line} `)
                ? headsign.slice(`${stoptime.line} `.length)
                : headsign
            )
              .trim()
              .split(" via ");
            if (via && fullHeadsign && headsignViaTo) {
              return `${via} - ${to}`;
            }
            if (via && fullHeadsign) {
              return `${to} via ${via}`;
            }
            if (fullHeadsign) {
              return to;
            }
            if (to.length > 20 && to.includes("-")) {
              const tos = to.split("-");
              const a = tos.at(0).trim();
              const b = tos.at(-1).trim();
              if (a === b) {
                return a;
              }
              return `${a} - ${b}`;
            }
            return to;
          },
          getStopAlerts: (stop) =>
            stop.alerts
              ? stop.alerts
                .map((alert) => ({
                  ...alert,
                  startTime: moment(alert.startTime),
                  endTime: moment(alert.endTime)
                }))
                .filter((alert) =>
                  moment().isBetween(alert.startTime, alert.endTime)
                )
                .map((alert) => ({
                  id: `${alert.alertSeverityLevel}:${alert.alertEffect}`,
                  icon: alert.alertSeverityLevel,
                  alertSeverityLevel: alert.alertSeverityLevel,
                  effect: this.translate(alert.alertEffect),
                  startTime: alert.startTime,
                  endTime: alert.endTime,
                  text: this.getAlertTranslation(alert, "alertHeaderText"),
                  description: this.getAlertTranslation(
                    alert,
                    "alertDescriptionText"
                  )
                }))
                .reduce(
                  (p, c) =>
                    p.some((item) => c.id === item.id) ? p : p.concat(c),
                  []
                )
              : undefined,
          getStoptimeStyles: (stop, stoptime) => {
            const styles = [];
            const agedStyle = this.getAgedStyle(stop);
            if (stoptime.cancelled) {
              styles.push("cancelled-trip");
            } else if (stoptime.remainingTime === 0) {
              styles.push("now");
            }
            if (stoptime.realtime) {
              styles.push("realtime");
            }
            if (agedStyle) {
              styles.push(agedStyle);
            }
            return styles.join(" ");
          },
          isBikeSeason: () => this.isBikeSeason(),
          setPrintedTime: (notification) => {
            if (!notification.printedTime) {
              const instance = this.getInstance();
              instance.notifications = instance.notifications.map((item) =>
                item.id === notification.id
                  ? { ...item, printedTime: moment() }
                  : item
              );
            }
          },
          validateStopRules: (stop) => this.validateStopRules(stop)
        },
        maps: {
          alertSeverityLevels: new Map([
            ["UNKNOWN_SEVERITY", "fa-solid fa-circle-question"],
            ["INFO", "fa-solid fa-circle-info"],
            ["WARNING", "fa-solid fa-triangle-exclamation"],
            ["SEVERE", "fa-solid fa-triangle-exclamation"]
          ]),
          platformNames: new Map([
            ["AIRPLANE", this.translate("PLATFORM")],
            ["BICYCLE", this.translate("BIKE_STATION")],
            ["BUS", this.translate("PLATFORM")],
            ["CABLE_CAR", this.translate("TRACK")],
            ["CAR", this.translate("PLATFORM")],
            ["FERRY", this.translate("PIER")],
            ["FUNICULAR", this.translate("TRACK")],
            ["GONDOLA", this.translate("TRACK")],
            ["RAIL", this.translate("TRACK")],
            ["SUBWAY", this.translate("TRACK")],
            ["TRAM", this.translate("PLATFORM")]
          ]),
          vehicleModes: new Map([
            // Vehicle modes according to DigiTransit documentation
            ["AIRPLANE", "fa-solid fa-plane-up"],
            ["BICYCLE", "fa-solid fa-bicycle"],
            ["BUS", "fa-solid fa-bus-simple"],
            ["CABLE_CAR", "fa-solid fa-cable-car"],
            ["CAR", "fa-solid fa-car"],
            ["FERRY", "fa-solid fa-ferry"],
            ["FUNICULAR", "fa-solid fa-cable-car"], // No icon found for funicular
            ["GONDOLA", "fa-solid fa-cable-car"], // A gondola (lift) should be the same as cable car
            ["RAIL", "fa-solid fa-train"],
            ["SUBWAY", "fa-solid fa-m"],
            ["TRAM", "fa-solid fa-train-tram"]
          ])
        }
      }
    ];
  },

  getTemplate() {
    const template = this.getTemplateObject().at(0);
    return `templates/${template}.njk`;
  },

  getTemplateData() {
    return this.getTemplateObject().at(1);
  },

  nunjucksEnvironment: function () {
    if (this._nunjucksEnvironment !== null) {
      return this._nunjucksEnvironment;
    }

    this._nunjucksEnvironment = new nunjucks.Environment(
      new nunjucks.WebLoader(this.file(""), { async: false }),
      {
        trimBlocks: true,
        lstripBlocks: true
      }
    );

    this._nunjucksEnvironment.addFilter("contextualize", (input) =>
      nunjucks.runtime.markSafe(
        Array.isArray(input)
          ? input.reduce((p, c) => ({ ...p, ...c }), {})
          : { ...input }
      )
    );
    this._nunjucksEnvironment.addFilter("letterize", (input) =>
      nunjucks.runtime.markSafe(String.fromCharCode(96 + parseInt(input)))
    );
    this._nunjucksEnvironment.addFilter("moment", (input) =>
      nunjucks.runtime.markSafe(moment(input).format(this.timeFormat))
    );
    this._nunjucksEnvironment.addFilter("translate", (input, variables) =>
      nunjucks.runtime.markSafe(this.translate(input, variables))
    );

    return this._nunjucksEnvironment;
  },

  getAgedStyle: function (stop) {
    const aged = stop.updateAge === true;
    const hasRemainingTimes = aged
      ? stop.stoptimes.some((stoptime) => stoptime.remainingTime >= 0)
      : undefined;
    return aged
      ? hasRemainingTimes
        ? "update-old"
        : "update-older"
      : undefined;
  },

  getAlertTranslation: function (alert, field) {
    const wantedField = `${field}Translations`;
    const wantedText =
      wantedField in alert && alert[wantedField]
        ? alert[wantedField].filter((item) => item.language === config.language)
        : undefined;
    return wantedText?.length ? wantedText.at(0).text : alert[field];
  },

  isBikeSeason: function () {
    return moment().isBetween(
      moment("20220401", "YYYYMMDD"),
      moment("20221101", "YYYYMMDD")
    );
  }
});
