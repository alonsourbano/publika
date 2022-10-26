// Based on code from Sami Mäkinen (https://github.com/ZakarFin)

const NOTIFICATION = {
  NOTIFICATION: { RESOLVE: "NOTIFICATION", API_KEY: "API_KEY_NOTIFICATION" },
  READY: { RESOLVE: "READY" },
  SEARCH_STOP: {
    FETCH: "SEARCH_STOP",
    REJECT: "REJECT_SEARCH_STOP",
    RESOLVE: "RESOLVE_SEARCH_STOP"
  },
  STOP_STOPTIMES: {
    FETCH: "FETCH_STOP_STOPTIMES",
    REJECT: "REJECT_STOP_STOPTIMES",
    RESOLVE: "RESOLVE_STOP_STOPTIMES"
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

  intervals: {
    update: {
      remainingTimeWatcher: 5 * 1000,
      default: 45 * 1000
    },
    retry: [1 * 1000, 5 * 1000, 10 * 1000, 20 * 1000, 45 * 1000]
  },
  digitransitApiUrl:
    "https://api.digitransit.fi/routing/v1/routers/hsl/index/graphql",
  timeFormat: config.timeFormat === 24 ? "HH:mm" : "h:mm a",
  notifications: [],
  sentNotifications: [],
  stoptimes: [],
  apiKeyDeadLine: undefined,
  debug: config.logLevel.includes("DEBUG"),

  notificationReceived: function (notification, payload, sender) {
    if (sender?.name === "clock") {
      return;
    }
    if (this.debug) {
      Log.log(notification, payload);
    }
    if (notification === "ALL_MODULES_STARTED") {
      return this.onAllModulesStarted();
    }
    if (notification === "DOM_OBJECTS_CREATED") {
      return this.onDomObjectsCreated();
    }

    Log.warn(`Unhandled notification ${notification}`, payload, sender);
  },

  processStopStoptimesNotification: function (notification, payload) {
    const self = this;
    const { data, ...stop } = payload;

    if (notification === NOTIFICATION.STOP_STOPTIMES.RESOLVE) {
      setTimeout(() => {
        self.sendSocketNotification(NOTIFICATION.STOP_STOPTIMES.FETCH, stop);
      }, this.getNextInterval(this.intervals.update.default));
      return this.updateStoptime(stop, data);
    }

    if (notification === NOTIFICATION.STOP_STOPTIMES.REJECT) {
      setTimeout(() => {
        self.sendSocketNotification(NOTIFICATION.STOP_STOPTIMES.FETCH, stop);
      }, this.getNextInterval(this.intervals.retry));
      return this.rejectStoptime(stop.id);
    }

    this.rejectSocketNotification(notification, payload);
  },

  processNotificationNotification: function (notification, payload) {
    const self = this;
    const alertModuleAvailable = MM.getModules().some(
      (module) => module.name === "alert" && !module.hidden
    );

    if (notification === NOTIFICATION.NOTIFICATION.RESOLVE) {
      if (alertModuleAvailable) {
        return this.sendNotification("SHOW_ALERT", payload);
      }

      this.notifications.push(payload);
      setTimeout(() => {
        self.notifications = self.notifications.filter(
          (item) => item.id !== payload.id
        );
        self.updateDom();
      }, payload.timer);
      return this.updateDom();
    }

    if (notification === NOTIFICATION.NOTIFICATION.API_KEY) {
      if (!this.config.hslApiKey) {
        const deadLined = moment().isSameOrAfter(this.apiKeyDeadLine);
        if (alertModuleAvailable) {
          if (deadLined) {
            this.notifications.push(payload);
          }
          return this.sendNotification("SHOW_ALERT", payload);
        }
        this.notifications.push(payload);
        setTimeout(() => {
          self.notifications = self.notifications.filter(
            (item) => item.id !== payload.id
          );
          self.updateDom();
        }, payload.timer);
        return this.updateDom();
      }
    }

    this.rejectSocketNotification(notification, payload);
  },

  processReadyNotification: function (notification, payload) {
    const self = this;

    if (notification === NOTIFICATION.READY.RESOLVE) {
      this.loaded = true;
      setInterval(() => {
        self.watchRemainingTime(self);
      }, this.intervals.update.remainingTimeWatcher);
      return this.config.stops
        .filter((stop) => !stop.disabled)
        .forEach((stop) => {
          const { id, stopTimesCount, type, minutesFrom } = stop;
          const normalizedStop = {
            id: id ?? stop,
            stopTimesCount: stopTimesCount ?? this.config.stopTimesCount,
            type,
            minutesFrom
          };
          if (stop.type === "cluster") {
            Log.error(this.translate("CLUSTER"));
            return this.notify(this.translate("CLUSTER"), 10);
          }
          if (typeof stop === "string" && isNaN(stop)) {
            return this.sendSocketNotification(
              NOTIFICATION.SEARCH_STOP.FETCH,
              normalizedStop
            );
          }
          return this.sendSocketNotification(
            NOTIFICATION.STOP_STOPTIMES.FETCH,
            normalizedStop
          );
        });
    }

    this.rejectSocketNotification(notification, payload);
  },

  processSearchStopNotification: function (notification, payload) {
    const self = this;
    const { data, ...stop } = payload;

    if (notification === NOTIFICATION.SEARCH_STOP.RESOLVE) {
      return this.updateStoptime(stop, data);
    }

    if (notification === NOTIFICATION.SEARCH_STOP.REJECT) {
      setTimeout(() => {
        self.sendSocketNotification(NOTIFICATION.SEARCH_STOP.FETCH, stop);
      }, this.getNextInterval(this.intervals.retry));
      return this.rejectStoptime(stop.id);
    }

    this.rejectSocketNotification(notification, payload);
  },

  checkSocketNotification: function (origin, target) {
    return Object.keys(target).some((item) => target[item] === origin);
  },

  socketNotificationReceived: function (notification, payload) {
    if (this.debug) {
      Log.log(notification, payload);
    }
    if (
      this.checkSocketNotification(notification, NOTIFICATION.STOP_STOPTIMES)
    ) {
      return this.processStopStoptimesNotification(notification, payload);
    }
    if (this.checkSocketNotification(notification, NOTIFICATION.NOTIFICATION)) {
      return this.processNotificationNotification(notification, payload);
    }
    if (this.checkSocketNotification(notification, NOTIFICATION.READY)) {
      return this.processReadyNotification(notification, payload);
    }
    if (this.checkSocketNotification(notification, NOTIFICATION.SEARCH_STOP)) {
      return this.processSearchStopNotification(notification, payload);
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

  watchRemainingTime: function (self) {
    self.stoptimes.forEach((stop) => {
      stop.stoptimes.forEach((stoptime) => {
        const time = moment(stoptime.time);
        const previousRemainingTime = stoptime.remainingTime;
        stoptime.remainingTime = Math.round(
          moment.duration(time.diff(moment())).asMinutes()
        );
        if (previousRemainingTime !== stoptime.remainingTime) {
          if (self.debug) {
            Log.log(
              `watchRemainingTime updated remaining time for service ${stoptime.line
              } departing from ${stop.meta.name} at ${time.format(self.timeFormat)}`
            );
          }
          self.updateDom();
        }
      });
    });
  },

  onAllModulesStarted: function () {
    if (!this.config.hslApiKey) {
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
      this.sendSocketNotification(
        NOTIFICATION.NOTIFICATION.API_KEY,
        hslNotification
      );
    }
  },

  onDomObjectsCreated: function () {
    this.sendSocketNotification("INIT", {
      digiTransit: {
        subscriptionKey: this.config.hslApiKey,
        apiUrl: this.digitransitApiUrl
      },
      debug: this.debug
    });
  },

  notify: function (message, seconds = 3) {
    const notification = {
      type: "notification",
      title: `Module ${this.name} (HSL timetables)`,
      message,
      timer: seconds * 1000
    };

    if (
      this.sentNotifications.some(
        (item) => JSON.stringify(item) === JSON.stringify(notification)
      )
    ) {
      return;
    }

    this.sendSocketNotification(
      NOTIFICATION.NOTIFICATION.RESOLVE,
      notification
    );
    this.sentNotifications.push(notification);
  },

  updateStoptime: function (stop, data) {
    const index = this.stoptimes.findIndex(
      (stoptime) => stoptime.id === stop.id
    );
    const { stopTimes, alerts, stops, ...meta } = data;
    this.stoptimes[index].stoptimes = stopTimes;
    this.stoptimes[index].meta = meta;
    this.stoptimes[index].alerts = alerts;
    this.stoptimes[index].searchStops = stops;
    this.updateDom();
  },

  rejectStoptime: function (id) {
    const index = this.stoptimes.findIndex((stoptime) => stoptime.id === id);
    this.stoptimes[index].stoptimes = { error: true };
    this.updateDom();
  },

  getTranslations: function () {
    return {
      en: "translations/en.json",
      fi: "translations/fi.json",
      sv: "translations/sv.json"
    };
  },

  getStyles: function () {
    return [this.file(`${this.name}.css`)];
  },

  start: function () {
    Log.info(`Starting module: ${this.name}`);
    this.config.stops
      .filter((stop) => !stop.disabled)
      .forEach((stop) => {
        this.stoptimes.push({
          id: stop.id ?? stop,
          ...stop,
          stoptimes: { empty: true }
        });
      });
  },

  getDom: function () {
    var wrapper = document.createElement("div");

    if (!this.config.stops.length) {
      wrapper.innerHTML = this.translate("SETUP_MODULE");
      wrapper.className = "dimmed light small";
      return wrapper;
    }

    if (!this.loaded) {
      wrapper.innerHTML = this.translate("LOADING");
      wrapper.className = "dimmed light small";
      return wrapper;
    }

    wrapper.className = "light small timetable";
    var htmlElements = [...this.stoptimes.keys()]
      .map((index) => this.getTable(this.stoptimes.at(index)))
      .join('<tr><td data-function="getDom">&nbsp;</td></tr>');
    wrapper.innerHTML = `${this.getNotifications()}<table id="stoptimes">${htmlElements}</table>`;

    return wrapper;
  },

  getNotifications: function () {
    if (this.notifications.length === 0) {
      return "";
    }
    const notifications = this.notifications
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
    if (stop.stoptimes?.empty || stop.stoptimes?.error) {
      return `${this.getHeaderRow(stop)}<tr><td colspan="${colspan}">${stop.type === "cluster" || stop.stoptimes?.error
        ? '<i class="fa-solid fa-xmark"></i> '
        : '<i class="fa-solid fa-spinner"></i> '
        }${this.translate(
          stop.type === "cluster"
            ? "CLUSTER"
            : stop.stoptimes?.error
              ? "ERROR"
              : "LOADING"
        )}</td></tr>`;
    }
    return stop.meta.responseType === "STOP_SEARCH"
      ? this.getTableForStopSearch(stop)
      : this.getTableForTimetable(stop);
  },

  getTableForTimetable: function (stop) {
    const headerRow = this.getHeaderRow(stop);
    const rows = stop.stoptimes
      .map(
        (item) =>
          `<tr${item.cancelled
            ? ' class="cancelled-trip"'
            : item.remainingTime === 0
              ? ' class="now"'
              : ""
          }>${this.getRowForTimetable(stop, item)}</tr>`
      )
      .reduce((p, c) => `${p}${c}`, "");
    const alerts = this.getAlerts(stop.alerts);
    return `${headerRow}${rows}${alerts}`;
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
      .filter(
        (alert) =>
          alert.trip?.gtfsId === stoptime.trip?.gtfsId ||
          alert.route?.gtfsId === stoptime.trip?.route?.gtfsId
      )
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
    const fullHeadsign =
      typeof stop.fullHeadsign === "undefined"
        ? this.config.fullHeadsign
        : stop.fullHeadsign;
    const headsignViaTo =
      typeof stop.headsignViaTo === "undefined"
        ? this.config.headsignViaTo
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
      }><th colspan="${colspan}">${header}</th></tr><tr class="stop-subheader"><td colspan="${colspan}">${this.getSubheaderRow(
        stop.meta,
        stop.minutesFrom
      )}<td>
      </tr>`;
  },

  getAlerts: function (alerts) {
    return alerts
      .map((alert) => ({
        id: `${alert.alertSeverityLevel}:${alert.alertEffect}`,
        icon: this.getAlertSeverityIcon(alert.alertSeverityLevel),
        effect: this.translate(alert.alertEffect),
        text: this.getAlertTranslation(alert, "alertHeaderText")
      }))
      .reduce(
        (p, c) => (p.some((item) => c.id === item.id) ? p : p.concat(c)),
        []
      )
      .map(
        (alert) =>
          `<tr><td data-function="getAlerts">&nbsp;</td><td class="alert" colspan="${colspan - 1
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
          `<span class="stop-code">${stop.code}</span>`,
          `<span class="stop-zone"><i class="fa-solid fa-${stop.zoneId.toLowerCase()}"></i></span>`
        ]
        : [
          `<span class="stop-code">${this.translate(
            stop.locationType
          )}</span>`,
          this.getZoneId(stop.zoneId)
        ];
    if (stop.platformCode) {
      items.splice(
        2,
        0,
        this.getPlatformText(stop.vehicleMode),
        `<span class="stop-platform">${stop.platformCode}</span>`
      );
    }
    if (minutesFrom) {
      items.push(
        `<span class="minutes-from">${minutesFrom > 0 ? `+${minutesFrom}` : minutesFrom
        } ${this.translate("MINUTES_ABBR")}</span>`
      );
    }
    return items.join(" ");
  },

  getZoneId: function (zone) {
    return `<span class="stop-zone"><i class="fa-solid fa-${zone.toLowerCase()}"></i></span>`;
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
