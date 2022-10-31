/* global nunjucks */

// Based on code from Sami Mäkinen (https://github.com/ZakarFin)

const NOTIFICATION = {
  NOTIFICATION: { RESOLVE: "NOTIFICATION", API_KEY: "API_KEY_NOTIFICATION" },
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
    stops: [],
    stopTimesCount: 5,
    theme: "color",
    fullHeadsign: false,
    headsignViaTo: false,
    hslApiKey: undefined
  },

  digitransitApiUrl:
    "https://api.digitransit.fi/routing/v1/routers/hsl/index/graphql",
  timeFormat: config.timeFormat === 24 ? "HH:mm" : "h:mm a",
  instances: [],
  apiKeyDeadLine: undefined,
  debug: config.logLevel.includes("DEBUG"),
  updateAgeLimitSeconds: 60,

  notificationReceived: function (notification, payload, sender) {
    if (sender?.name === "clock") {
      return;
    }
    if (sender?.name === "publika") {
      return;
    }
    if (this.debug) {
      Log.log(notification, payload);
    }
    if (notification === "ALL_MODULES_STARTED") {
      return this.onAllModulesStarted();
    }
    if (notification === "DOM_OBJECTS_CREATED") {
      return;
    }
    if (notification === "MODULE_DOM_CREATED") {
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

      instance.notifications.push(payload);
      setTimeout(() => {
        instance.notifications = instance.notifications.filter(
          (item) => item.id !== payload.id
        );
        this.updateDom();
      }, payload.timer);
      return this.updateDom();
    }

    if (notification === NOTIFICATION.NOTIFICATION.API_KEY) {
      const deadLined = moment().isSameOrAfter(this.apiKeyDeadLine);
      if (alertModuleAvailable) {
        if (deadLined) {
          instance.notifications.push(payload);
        }
        return this.sendNotification("SHOW_ALERT", payload);
      }
      instance.notifications.push(payload);
      setTimeout(() => {
        instance.notifications = instance.notifications.filter(
          (item) => item.id !== payload.id
        );
        this.updateDom();
      }, payload.timer);
      return this.updateDom();
    }

    this.rejectSocketNotification(notification, payload);
  },

  processReadyNotification: function (instance, notification, payload) {
    if (notification === NOTIFICATION.READY.RESOLVE) {
      const batch = instance.config.stops
        .filter((stop) => !stop.disabled)
        .filter(this.validateStopRules)
        .map((stop) => {
          if (stop.type === "cluster") {
            Log.error(this.translate("CLUSTER"));
            this.notify(this.translate("CLUSTER"), 10);
            return undefined;
          }
          const { id, stopTimesCount, type, minutesFrom } = stop;
          const normalizedStop = {
            id: id ?? stop,
            stopTimesCount: stopTimesCount ?? instance.config.stopTimesCount,
            type,
            minutesFrom
          };
          if (typeof stop === "string" && isNaN(stop)) {
            return {
              notification: NOTIFICATION.SEARCH_STOP.FETCH,
              payload: normalizedStop
            };
          }
          return {
            notification: NOTIFICATION.STOP_STOPTIMES.FETCH,
            payload: normalizedStop
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
      return this.updateStoptime(instance, stop, data);
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

  checkSocketNotification: function (origin, target) {
    return Object.keys(target).some((item) => target[item] === origin);
  },

  socketNotificationReceived: function (notification, payload) {
    const [instanceId, notificationType] = notification.split("::");

    if (instanceId !== this.identifier) {
      return;
    }

    if (this.debug) {
      Log.log(notification, payload);
    }

    const instance = this.getInstance();

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
          if (previousRemainingTime !== stoptime.remainingTime) {
            if (this.debug) {
              Log.log(
                `${this.name}::${this.identifier
                }::watchRemainingTime updated remaining time for service ${stoptime.line
                } departing from ${stop.meta.name} at ${time.format(
                  this.timeFormat
                )}`
              );
            }
            this.updateDom();
          }
        });
    });
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
          if (this.debug) {
            Log.warn(
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
      lastUpdate.isBefore(
        moment().subtract(this.updateAgeLimitSeconds, "seconds")
      )
    ) {
      this.sendInstanceSocketNotification(
        NOTIFICATION.WATCHER.WAKE_UP,
        undefined
      );
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
          remainingTimeWatcher: undefined,
          socketWatcher: undefined,
          updateStatusWatcher: undefined
        },
        config: { ...this.defaults, ...module.config },
        core: modules.length === 1 || module.config.core,
        intervals: {
          update: {
            remainingTimeWatcher: 5 * 1000,
            socketWatcher: 100 * 1000,
            updateStatusWatcher: 5 * 1000,
            default: 45 * 1000
          },
          retry: [1 * 1000, 5 * 1000, 10 * 1000, 20 * 1000, 45 * 1000]
        },
        notifications: [],
        sentNotifications: [],
        stops: module.config.stops
          .filter((stop) => !stop.disabled)
          .filter(this.validateStopRules)
          .map((stop) => ({
            ...stop,
            id: stop.id ?? stop,
            stoptimes: { empty: true }
          }))
      }));
    const instance = this.getInstance();
    if (instance.config?.theme) {
      this.loadStyles(() => {
        Log.log("Styles reloaded");
      });
    }
    this.sendInitNotification(instance);
    if (
      instance.core &&
      instance.id === this.identifier &&
      !instance.config.hslApiKey
    ) {
      this.apiKeyDeadLine = moment("20230403", "YYYYMMDD");
      const deadLined = moment().isSameOrAfter(this.apiKeyDeadLine);
      const hslNotification = {
        title: `Module ${this.name} (HSL timetables)`,
        type: deadLined ? undefined : "notification",
        message: `Starting from ${this.apiKeyDeadLine.format(
          "LL"
        )}, the use of the Digitransit APIs will require registration and use of API keys. Registration can be done at the Digitransit API portal.`,
        timer: 15 * 1000
      };
      this.sendInstanceSocketNotification(
        NOTIFICATION.NOTIFICATION.API_KEY,
        hslNotification
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
    this.sendInstanceSocketNotification(NOTIFICATION.READY.INIT, undefined);
  },

  sendCoreInitNotification: function (instance) {
    if (instance.core && instance.id === this.identifier) {
      this.sendInstanceSocketNotification(NOTIFICATION.READY.CORE_INIT, {
        digiTransit: {
          subscriptionKey: instance.config.hslApiKey,
          apiUrl: this.digitransitApiUrl
        },
        debug: this.debug
      });
    }
  },

  sendInstanceSocketNotification: function (notification, payload) {
    this.sendSocketNotification(`${this.identifier}::${notification}`, payload);
  },

  notify: function (message, seconds) {
    const instance = this.getInstance();
    const notification = {
      type: "notification",
      title: `Module ${this.name} (HSL timetables)`,
      message,
      timer: seconds * 1000
    };

    if (
      instance.sentNotifications.some(
        (item) => JSON.stringify(item) === JSON.stringify(notification)
      )
    ) {
      return;
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
    const { stopTimes, alerts, stops, stopsLength, ...meta } = data;
    instance.stops[index].stoptimes = stopTimes;
    instance.stops[index].stopsLength = stopsLength;
    instance.stops[index].meta = meta;
    instance.stops[index].alerts = alerts;
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
    if (!stop.rules) {
      return true;
    }
    try {
      for (const rule of stop.rules) {
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
      }
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
    const { config, coreError, notifications, stops } = this.getInstance();
    if (coreError) {
      return ["default/error", { message: this.translate(coreError) }];
    }
    if (!config?.stops?.length) {
      return ["default/error", { message: this.translate("SETUP_MODULE") }];
    }
    return [
      "default/normal",
      {
        config: { debug: this.debug, theme: config.theme },
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
          getHeadsignText: (stop, stoptime) => {
            if (!stoptime.headsign) {
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
            const [to, via] = stoptime.headsign.split(" via ");
            return fullHeadsign && via
              ? headsignViaTo
                ? `${via} - ${to}`
                : `${to} via ${via}`
              : to;
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
                  text: this.getAlertTranslation(alert, "alertHeaderText")
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
          validateStopRules: (stop) => this.validateStopRules(stop)
        },
        maps: {
          alertSeverityLevels: new Map([
            ["UNKNOWN_SEVERITY", "fa-solid fa-circle-question"],
            ["INFO", "fa-solid fa-circle-info"],
            ["WARNING", "fa-solid fa-triangle-exclamation"],
            ["SEVERE", "fa-solid fa-radiation"]
          ]),
          platformNames: new Map([
            ["AIRPLANE", this.translate("PLATFORM")],
            ["BICYCLE", this.translate("PLATFORM")],
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
  }
});
