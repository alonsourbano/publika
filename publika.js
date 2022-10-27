// Based on code from Sami Mäkinen (https://github.com/ZakarFin)

const NOTIFICATION = {
  NOTIFICATION: { RESOLVE: "NOTIFICATION", API_KEY: "API_KEY_NOTIFICATION" },
  READY: { RESOLVE: "READY", INIT: "INIT", CORE_INIT: "CORE_INIT" },
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
    WAKE_UP: "WAKE_UP"
  }
};

const colspan = 4;

Module.register("publika", {
  defaults: {
    stops: [],
    stopTimesCount: 5,
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
      setTimeout(() => {
        this.sendInstanceSocketNotification(
          NOTIFICATION.STOP_STOPTIMES.FETCH,
          stop
        );
      }, this.getNextInterval(instance.intervals.update.default));
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
      instance.loaded = true;
      return instance.config.stops
        .filter((stop) => !stop.disabled)
        .forEach((stop) => {
          const { id, stopTimesCount, type, minutesFrom } = stop;
          const normalizedStop = {
            id: id ?? stop,
            stopTimesCount: stopTimesCount ?? instance.config.stopTimesCount,
            type,
            minutesFrom
          };
          if (stop.type === "cluster") {
            Log.error(this.translate("CLUSTER"));
            return this.notify(this.translate("CLUSTER"), 10);
          }
          if (typeof stop === "string" && isNaN(stop)) {
            return this.sendInstanceSocketNotification(
              NOTIFICATION.SEARCH_STOP.FETCH,
              normalizedStop
            );
          }
          return this.sendInstanceSocketNotification(
            NOTIFICATION.STOP_STOPTIMES.FETCH,
            normalizedStop
          );
        });
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
            loaded: true,
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
        core: modules.length === 1 ?? module.config.core,
        intervals: {
          update: {
            remainingTimeWatcher: 5 * 1000,
            socketWatcher: 100 * 1000,
            updateStatusWatcher: 5 * 1000,
            default: 45 * 1000
          },
          retry: [1 * 1000, 5 * 1000, 10 * 1000, 20 * 1000, 45 * 1000]
        },
        loaded: false,
        notifications: [],
        sentNotifications: [],
        stops: module.config.stops
          .filter((stop) => !stop.disabled)
          .map((stop) => ({
            ...stop,
            id: stop.id ?? stop,
            stoptimes: { empty: true }
          }))
      }));
    const instance = this.getInstance();
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
    if (instance.core && instance.id === this.identifier) {
      this.sendInstanceSocketNotification(NOTIFICATION.READY.CORE_INIT, {
        digiTransit: {
          subscriptionKey: instance.config.hslApiKey,
          apiUrl: this.digitransitApiUrl
        },
        debug: this.debug
      });
    }
    this.sendInstanceSocketNotification(NOTIFICATION.READY.INIT, undefined);
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
    const { stopTimes, alerts, stops, ...meta } = data;
    instance.stops[index].stoptimes = stopTimes;
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
    return [this.file(`${this.name}.css`)];
  },

  getDom: function () {
    var wrapper = document.createElement("div");
    const instance = this.getInstance();

    if (!instance.loaded) {
      wrapper.innerHTML = this.translate("LOADING");
      wrapper.className = "dimmed light small";
      return wrapper;
    }

    if (instance.coreError) {
      wrapper.innerHTML = this.translate(instance.coreError);
      wrapper.className = "dimmed light small";
      return wrapper;
    }

    if (!instance.config.stops.length) {
      wrapper.innerHTML = this.translate("SETUP_MODULE");
      wrapper.className = "dimmed light small";
      return wrapper;
    }

    wrapper.className = "light small timetable";
    var htmlElements = [...instance.stops.keys()]
      .map((index) => this.getTable(instance.stops.at(index)))
      .join('<tr><td data-function="getDom">&nbsp;</td></tr>');
    wrapper.innerHTML = `${this.getNotifications()}<table id="stoptimes">${htmlElements}</table>`;

    return wrapper;
  },

  getNotifications: function () {
    const instance = this.getInstance();
    if (instance.notifications.length === 0) {
      return "";
    }
    const notifications = instance.notifications
      .map(
        (notification) =>
          `<tr><td colspan="${colspan}">${notification.message}</td></tr>`
      )
      .join("");
    return `<div class="notification"><table id="notifications">${notifications}</table></div>`;
  },

  getTable: function (stop) {
    if (!stop) {
      return `<span>${this.translate("ERROR_SCHEDULE")}</span>`;
    }
    if (stop.disabled) {
      return "";
    }
    if (
      stop.stoptimes?.empty ||
      stop.stoptimes?.error ||
      stop.type === "cluster"
    ) {
      var icon = '<i class="fa-solid fa-spinner"></i>';
      var text = "LOADING";
      if (stop.type === "cluster") {
        icon = '<i class="fa-solid fa-xmark"></i>';
        text = "CLUSTER";
      } else if (stop.stoptimes?.error) {
        icon = '<i class="fa-solid fa-xmark"></i>';
        text = "ERROR";
      }
      return `${this.getHeaderRow(
        stop
      )}<tr><td colspan="${colspan}">${icon} ${this.translate(text)}</td></tr>`;
    }
    return stop.meta.responseType === "STOP_SEARCH"
      ? this.getTableForStopSearch(stop)
      : this.getTableForTimetable(stop);
  },

  getTableForTimetable: function (stop) {
    const headerRow = this.getHeaderRow(stop);
    const aged = stop.updateAge === true;
    const agedText = aged
      ? `<tr><td colspan="${colspan}"><i class="fa-solid fa-hourglass-end"></i> ${this.translate(
        "UPDATE_OLD"
      )}</td></tr>`
      : "";
    const hasRemainingTimes = stop.stoptimes.some(
      (item) => item.remainingTime >= 0
    );
    const agedStyle = aged
      ? hasRemainingTimes
        ? "update-old"
        : "update-older"
      : undefined;
    const rows = stop.stoptimes
      .map((item) => {
        const styles = [];
        if (item.cancelled) {
          styles.push("cancelled-trip");
        } else if (item.remainingTime === 0) {
          styles.push("now");
        }
        if (agedStyle) {
          styles.push(agedStyle);
        }
        return `<tr${styles.length ? ` class="${styles.join(" ")}"` : ""
          }>${this.getRowForTimetable(stop, item)}</tr>`;
      })
      .reduce((p, c) => `${p}${c}`, "");
    const alerts = this.getAlerts(stop.alerts, agedStyle);
    return `${headerRow}${agedText}${rows}${alerts}`;
  },

  getRowForTimetable: function (stop, stoptime) {
    return [
      this.getRouteShortName(stoptime),
      this.getHeadsign(stop, stoptime),
      {
        value: stoptime.cancelled
          ? '<i class="fa-solid fa-xmark"></i>'
          : this.getRemainingTimeText(stoptime),
        style: "time smaller"
      },
      {
        value: moment(stoptime.time).format(this.timeFormat),
        style: "time"
      }
    ]
      .map(
        (column) =>
          `<td${column.style ? ` class="${column.style}"` : ""}>${column.value ?? column
          }</td>`
      )
      .reduce((p, c) => `${p}${c}`, "");
  },

  getRouteShortName: function (stoptime) {
    const defaultValue = { value: stoptime.line, style: "route-line" };
    if (stoptime.cancelled) {
      return defaultValue;
    }
    if (stoptime.line.length === 1) {
      return {
        value: `<i class="fa-regular fa-${stoptime.line.toLowerCase()}"></i>`,
        style: "route-line route-line-icon"
      };
    }
    if (stoptime.line.length === 2) {
      return {
        value: `<i class="fa-regular fa-${stoptime.line
          .charAt(0)
          .toLowerCase()}"></i> <i class="fa-regular fa-${stoptime.line
            .charAt(1)
            .toLowerCase()}"></i>`,
        style: "route-line route-line-icon"
      };
    }
    return defaultValue;
  },

  getHeadsign: function (stop, stoptime) {
    const headsign = this.getHeadsignText(stop, stoptime);
    const alerts = stop.alerts
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
      .filter((alert) => moment().isBetween(alert.startTime, alert.endTime))
      .reduce(
        (p, c) =>
          p.some((item) => c.alertSeverityLevel === item)
            ? p
            : p.concat(c.alertSeverityLevel),
        []
      )
      .map((alertSeverityLevel) =>
        this.getAlertSeverityIcon(alertSeverityLevel, "alert")
      )
      .join(" ");
    return alerts.length ? `${alerts} ${headsign}` : headsign;
  },

  getHeadsignText: function (stop, stoptime) {
    if (!stoptime.headsign) {
      return "";
    }
    const instance = this.getInstance();
    const fullHeadsign =
      typeof stop.fullHeadsign === "undefined"
        ? instance.config.fullHeadsign
        : stop.fullHeadsign;
    const headsignViaTo =
      typeof stop.headsignViaTo === "undefined"
        ? instance.config.headsignViaTo
        : stop.headsignViaTo;
    const [to, via] = stoptime.headsign.split(" via ");
    return fullHeadsign && via
      ? headsignViaTo
        ? `${via} - ${to}`
        : `${to} via ${via}`
      : to;
  },

  getTableForStopSearch: function (stop) {
    const headerRow = `<tr class="stop-header"><th colspan="${colspan}"><i class="fa-solid fa-magnifying-glass"></i> ${stop.id}</th></tr>`;
    const rows =
      stop.searchStops
        .map((item) => {
          const [, stopId] = item.gtfsId.split(":");
          const [, stationId] = item.parentStation
            ? item.parentStation.gtfsId.split(":")
            : "";
          return `<tr><td colspan="${colspan}">${this.getStopNameWithVehicleMode(
            item,
            stopId
          )}</td></tr><tr class="stop-subheader"><td colspan="${colspan}">${this.getSubheaderRow(
            item,
            0
          )}</td></tr><tr class="stop-subheader"><td colspan="${colspan}">${this.translate(
            "STATION"
          )}: ${stationId} • ${item.parentStation?.name}</td></tr>`;
        })
        .join(
          '<tr><td data-function="getTableForStopSearch">&nbsp;</td></tr>'
        ) ||
      `<tr><td title="getTableForStopSearch"><i class="fa-solid fa-circle-exclamation"></i> ${this.translate(
        "NO_DATA"
      )}</td></tr>`;
    return `${headerRow}${rows}`;
  },

  getRemainingTimeText: function (item) {
    if (item.remainingTime > 20) {
      return "";
    }
    const realtimeIcon = item.realtime ? "" : "~";
    return item.remainingTime === 0
      ? `${realtimeIcon}${this.translate("NOW")}`
      : item.remainingTime > 0
        ? `${realtimeIcon}${item.remainingTime} ${this.translate("MINUTES_ABBR")}`
        : '<i class="fa-solid fa-clock-rotate-left"></i>';
  },

  getHeaderRow: function (stop) {
    if (!stop.meta) {
      return `<tr class="stop-header"><th colspan="${colspan}">HSL:${stop.id}</th></tr>`;
    }
    const header = stop.name
      ? `${this.getStopNameWithVehicleMode(stop.meta)} - ${stop.name}`
      : this.getStopNameWithVehicleMode(stop.meta);
    return `<tr class="stop-header"${this.debug ? ` data-source='${JSON.stringify(stop)}'` : ""
      }><th colspan="${colspan}">${header}</th></tr>
      <tr class="stop-subheader"><td colspan="${colspan}">${this.getSubheaderRow(
        stop.meta,
        stop.minutesFrom
      )}<td>
      </tr>`;
  },

  getAlerts: function (alerts, style = "") {
    return alerts
      .map((alert) => ({
        ...alert,
        startTime: moment(alert.startTime),
        endTime: moment(alert.endTime)
      }))
      .filter((alert) => moment().isBetween(alert.startTime, alert.endTime))
      .map((alert) => ({
        id: `${alert.alertSeverityLevel}:${alert.alertEffect}`,
        icon: this.getAlertSeverityIcon(alert.alertSeverityLevel),
        effect: this.translate(alert.alertEffect),
        startTime: alert.startTime,
        endTime: alert.endTime,
        text: this.getAlertTranslation(alert, "alertHeaderText")
      }))
      .reduce(
        (p, c) => (p.some((item) => c.id === item.id) ? p : p.concat(c)),
        []
      )
      .map(
        (alert) =>
          `<tr${style ? ` class="${style}"` : ""
          }><td data-function="getAlerts">&nbsp;</td><td class="alert" colspan="${colspan - 1
          }">${alert.icon} ${alert.effect}</td></tr>`
      )
      .join("");
  },

  getAlertSeverityIcon: function (alertSeverityLevel, style) {
    const defaultIcon = `<i class="${style} fa-solid fa-circle-question"></i>`;
    return (
      new Map([
        [
          "UNKNOWN_SEVERITY",
          `<i class="${style} fa-solid fa-circle-question"></i>`
        ],
        ["INFO", `<i class="${style} fa-solid fa-circle-info"></i>`],
        [
          "WARNING",
          `<i class="${style} fa-solid fa-triangle-exclamation"></i>`
        ],
        ["SEVERE", `<i class="${style} fa-solid fa-radiation"></i>`]
      ]).get(alertSeverityLevel) ?? defaultIcon
    );
  },

  getAlertTranslation: function (alert, field) {
    const wantedField = `${field}Translations`;
    const wantedText =
      wantedField in alert && alert[wantedField]
        ? alert[wantedField].filter((item) => item.language === config.language)
        : undefined;
    return wantedText?.length ? wantedText.at(0).text : alert[field];
  },

  getSubheaderRow: function (stop, minutesFrom) {
    const items =
      stop.locationType === "STOP"
        ? [
          stop.desc,
          { value: stop.code, style: "stop-code" },
          {
            value: `<i class="fa-solid fa-${stop.zoneId.toLowerCase()}"></i>`,
            style: "stop-zone"
          }
        ]
        : [
          {
            value: this.translate(stop.locationType),
            style: "stop-code"
          },
          { value: this.getZoneId(stop.zoneId), style: "stop-zone" }
        ];
    if (stop.platformCode) {
      items.splice(2, 0, this.getPlatformText(stop.vehicleMode), {
        value: stop.platformCode,
        style: "stop-platform"
      });
    }
    if (minutesFrom) {
      items.push({
        value: `${minutesFrom > 0 ? `+${minutesFrom}` : minutesFrom
          } ${this.translate("MINUTES_ABBR")}`,
        style: "minutes-from"
      });
    }
    return items
      .map(
        (item) =>
          `<span${item.style ? ` class="${item.style}"` : ""}>${item.value ?? item
          }</span>`
      )
      .join("");
  },

  getZoneId: function (zone) {
    return `<i class="fa-solid fa-${zone.toLowerCase()}"></i>`;
  },

  getStopNameWithVehicleMode: function (data, includeId = undefined) {
    const name = includeId ? `${includeId} • ${data.name}` : data.name;
    return `${this.getVehicleModeIcon(data.vehicleMode)} ${name}`;
  },

  getVehicleModeIcon: function (vehicleMode) {
    // Vehicle modes according to HSL documentation
    const map = new Map([
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
    ]);
    return `<i class="${map.get(vehicleMode)}"></i>`;
  },

  getPlatformText: function (vehicleMode) {
    const defaultText = this.translate("PLATFORM");
    return new Map([
      ["AIRPLANE", defaultText],
      ["BICYCLE", defaultText],
      ["BUS", defaultText],
      ["CABLE_CAR", this.translate("TRACK")],
      ["CAR", defaultText],
      ["FERRY", this.translate("PIER")],
      ["FUNICULAR", this.translate("TRACK")],
      ["GONDOLA", this.translate("TRACK")],
      ["RAIL", this.translate("TRACK")],
      ["SUBWAY", this.translate("TRACK")],
      ["TRAM", defaultText]
    ]).get(vehicleMode);
  }
});
