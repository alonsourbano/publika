// Based on code from Sami Mäkinen (https://github.com/ZakarFin)

const NOTIFICATION = {
  CLUSTER_STOPTIMES: {
    FETCH: "FETCH_CLUSTER_STOPTIMES",
    REJECT: "REJECT_CLUSTER_STOPTIMES",
    RESOLVE: "RESOLVE_CLUSTER_STOPTIMES"
  },
  NOTIFICATION: { RESOLVE: "NOTIFICATION" },
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

const colspan = 'colspan="4"';

Module.register("publika", {
  defaults: {
    stops: [],
    stopTimesCount: 5,
    fullHeadsign: false,
    hslApiKey: undefined
  },

  intervals: {
    update: {
      cancelledTrips: [1000 * 1000, 5 * 1000, 10 * 1000, 20 * 1000, 60 * 1000],
      default: 20 * 1000
    },
    retry: [1 * 1000, 5 * 1000, 10 * 1000, 20 * 1000, 45 * 1000]
  },
  digitransitApiUrl:
    "https://api.digitransit.fi/routing/v1/routers/hsl/index/graphql",
  timeFormat: config.timeFormat === 24 ? "HH:mm" : "h:mm a",
  notifications: [],
  stoptimes: [],
  cancelledTrips: [],
  apiKeyDeadLine: undefined,

  notificationReceived: function (notification, payload, sender) {
    if (notification === "ALL_MODULES_STARTED") {
      return this.onAllModulesStarted();
    }
    if (notification === "DOM_OBJECTS_CREATED") {
      return this.onDomObjectsCreated();
    }
    if (sender?.name === "clock") {
      return;
    }

    Log.warn(`Unhandled notification ${notification}`, payload, sender);
  },

  processClusterStoptimesNotification: function (notification, payload) {
    const self = this;
    const { data, ...stop } = payload;

    if (notification === NOTIFICATION.CLUSTER_STOPTIMES.RESOLVE) {
      setTimeout(() => {
        self.sendSocketNotification(NOTIFICATION.CLUSTER_STOPTIMES.FETCH, stop);
      }, this.getNextInterval(this.intervals.update.default));
      return this.updateStoptime(stop, data);
    }

    if (notification === NOTIFICATION.CLUSTER_STOPTIMES.REJECT) {
      setTimeout(() => {
        self.sendSocketNotification(NOTIFICATION.CLUSTER_STOPTIMES.FETCH, stop);
      }, this.getNextInterval(this.intervals.retry));
      return this.rejectStoptime(stop.id);
    }

    this.rejectSocketNotification(notification, payload);
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

    if (notification === NOTIFICATION.NOTIFICATION.RESOLVE) {
      if (!this.config.hslApiKey) {
        const deadLined = moment().isSameOrAfter(this.apiKeyDeadLine);
        const alertModuleAvailable = MM.getModules().some(
          (module) => module.name === "alert" && !module.hidden
        );
        if (alertModuleAvailable) {
          this.sendNotification("SHOW_ALERT", payload);
          if (deadLined) {
            this.notifications.push(payload);
          }
        } else {
          this.notifications.push(payload);
          setTimeout(() => {
            self.notifications = self.notifications.filter(
              (item) => item.id !== payload.id
            );
            self.updateDom();
          }, payload.timer);
          this.updateDom();
        }
      }
      return;
    }

    this.rejectSocketNotification(notification, payload);
  },

  processReadyNotification: function (notification, payload) {
    if (notification === NOTIFICATION.READY.RESOLVE) {
      this.loaded = true;
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
            return this.sendSocketNotification(
              NOTIFICATION.CLUSTER_STOPTIMES.FETCH,
              normalizedStop
            );
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
    if (
      this.checkSocketNotification(notification, NOTIFICATION.STOP_STOPTIMES)
    ) {
      return this.processStopStoptimesNotification(notification, payload);
    }
    if (
      this.checkSocketNotification(notification, NOTIFICATION.CLUSTER_STOPTIMES)
    ) {
      return this.processClusterStoptimesNotification(notification, payload);
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
    throw Error(errorMessage);
  },

  getNextInterval: function (interval) {
    return Array.isArray(interval)
      ? interval.length === 1
        ? interval.at(0)
        : interval.shift()
      : interval;
  },

  onAllModulesStarted: function () {
    if (!this.config.hslApiKey) {
      this.apiKeyDeadLine = moment("20230403", "YYYYMMDD");
      const deadLined = moment().isSameOrAfter(this.apiKeyDeadLine);
      const hslNotification = {
        title: "Module publika (HSL timetables)",
        type: deadLined ? undefined : "notification",
        message: `Starting from ${this.apiKeyDeadLine.format(
          "LL"
        )}, the use of the Digitransit APIs will require registration and use of API keys. Registration can be done at the Digitransit API portal.`,
        timer: (deadLined ? 20 : 10) * 1000
      };
      this.sendSocketNotification("NOTIFICATION", hslNotification);
    }
  },

  onDomObjectsCreated: function () {
    this.sendSocketNotification("INIT", {
      digiTransit: {
        subscriptionKey: this.config.hslApiKey,
        apiUrl: this.digitransitApiUrl
      }
    });
  },

  notify: function (message, seconds = 3) {
    const alertModuleAvailable = MM.getModules().some(
      (module) => module.name === "alert" && !module.hidden
    );
    const notification = {
      type: "notification",
      message,
      timer: seconds * 1000
    };

    if (alertModuleAvailable) {
      return this.sendNotification("SHOW_ALERT", notification);
    }

    this.notifications.push(notification);
    setTimeout(() => {
      this.notifications = this.notifications.filter(
        (item) => item.id !== notification.id
      );
      this.updateDom();
    }, notification.timer);
    this.updateDom();
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
      wrapper.innerHTML = `${this.translate("SETUP_MODULE")}`;
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
      .join('<tr><td title="getDom">&nbsp;</td></tr>');
    wrapper.innerHTML = `${this.getNotifications()}<table>${htmlElements}</table>`;

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
      .reduce((p, c) => `${p}${c}`, "");
    return `<div class="notification"><table>${notifications}</table></div>`;
  },

  getTable: function (stop) {
    if (!stop) {
      return `< span > ${this.translate("ERROR_SCHEDULE")}</span > `;
    }
    if (stop.disabled) {
      return "";
    }
    if (stop.stoptimes?.empty || stop.stoptimes?.error) {
      return `${this.getHeaderRow(stop)}<tr><td ${colspan}>${stop.stoptimes?.error
        ? '<i class="fa-solid fa-xmark"></i> '
        : '<i class="fa-solid fa-spinner"></i> '
        }${this.translate(
          stop.stoptimes?.error ? "ERROR" : "LOADING"
        )}</td></tr>`;
    }
    return stop.meta.responseType === "STOP_SEARCH"
      ? this.getTableForStopSearch(stop)
      : this.getTableForTimetable(stop);
  },

  getTableForTimetable: function (stop) {
    const headerRow = this.getHeaderRow(stop);
    const rows = this.getStoptimes(stop)
      .map(
        (item) =>
          `<tr${item.cancelled
            ? ' class="cancelled-trip"'
            : item.until === 0
              ? ' class="now"'
              : ""
          }>${this.getRowForTimetable(stop, item)}</tr>`
      )
      .reduce((p, c) => `${p}${c}`, "");
    const stopAlerts = this.getSingleDimensionArray(
      stop.alerts,
      "effectiveStartDate"
    );
    const alerts =
      stopAlerts.length > 0
        ? stopAlerts.map(
          (alert) =>
            `<tr><td ${colspan}><i class="fa-solid fa-triangle-exclamation"></i> ${alert.alertHash}<td></tr>`
        )
        : "";
    return `${headerRow}${rows}${alerts}`;
  },

  getSingleDimensionArray: function (items, sortKey) {
    if (items.length === 0) {
      return items;
    }
    if (!Array.isArray(items.at(0))) {
      return items;
    }
    return items
      .reduce((p, c) => [...p, ...c], [])
      .sort((a, b) => a[sortKey] - b[sortKey]);
  },

  getStoptimes: function (stop) {
    const stoptimes = this.getSingleDimensionArray(stop.stoptimes, "ts");
    return stoptimes;
  },

  getRowForTimetable: function (stop, stoptime) {
    const columns = stoptime.cancelled
      ? this.getCancelledRow(stop, stoptime)
      : this.getScheduledRow(stop, stoptime);
    return columns
      .map(
        (column) =>
          `<td${column.style ? ` class="${column.style}"` : ""}>${column.value ?? column
          }</td>`
      )
      .reduce((p, c) => `${p}${c}`, "");
  },

  getScheduledRow: function (stop, stoptime) {
    return [
      stoptime.line,
      this.getHeadsign(stop, stoptime),
      { value: this.getUntilText(stoptime), style: "time smaller" },
      {
        value: moment(stoptime.time).format(this.timeFormat),
        style: "time"
      }
    ];
  },

  getCancelledRow: function (stop, stoptime) {
    return [
      stoptime.line,
      this.getHeadsign(stop, stoptime),
      { value: '<i class="fa-solid fa-xmark"></i>', style: "time" },
      {
        value: moment(stoptime.time).format(this.timeFormat),
        style: "time"
      }
    ];
  },

  getHeadsign: function (stop, stoptime) {
    if (!stoptime.headsign) {
      return "";
    }
    const fullHeadsign =
      typeof stop.fullHeadsign === "undefined"
        ? this.config.fullHeadsign
        : stop.fullHeadsign;
    const [to] = stoptime.headsign.split(" via ");
    const headsign = fullHeadsign ? stoptime.headsign : to;
    return stoptime.alerts?.length > 0
      ? `<i class="fa-solid fa-triangle-exclamation"></i> ${headsign}`
      : headsign;
  },

  getTableForStopSearch: function (stop) {
    const headerRow = `<tr class="stop-header"><th ${colspan}><i class="fa-solid fa-magnifying-glass"></i> ${stop.id}</th></tr>`;
    const rows =
      stop.searchStops
        .map(
          (item) =>
            `<tr><td ${colspan}>${this.getStopNameWithVehicleMode(
              item,
              item.gtfsId?.split(":").at(1)
            )}</td></tr><tr class="stop-subheader"><td ${colspan}>${this.getSubheaderRow(
              item,
              stop.minutesFrom
            )}</td></tr><tr class="stop-subheader"><td ${colspan}>${this.translate(
              "STATION"
            )}: ${item.parentStation?.gtfsId.split(":").at(1)} • ${item.parentStation?.name
            }</td></tr><tr class="stop-subheader"><td ${colspan}>${this.translate(
              "CLUSTER"
            )}: ${item.cluster?.gtfsId} • ${item.cluster?.name}</td></tr>`
        )
        .join('<tr><td title="getTableForStopSearch">&nbsp;</td></tr>') ||
      `<tr><td title="getTableForStopSearch"><i class="fa-solid fa-circle-exclamation"></i> ${this.translate(
        "NO_DATA"
      )}</td></tr>`;
    return `${headerRow}${rows}`;
  },

  getUntilText: function (item) {
    if (item.until > 20) {
      return "";
    }
    const realtimeIcon = item.realtime ? "" : "~";
    return item.until === 0
      ? `${realtimeIcon}${this.translate("NOW")}`
      : item.until > 0
        ? `${realtimeIcon}${item.until} ${this.translate("MINUTES_ABBR")}`
        : '<i class="fa-solid fa-clock-rotate-left"></i>';
  },

  getHeaderRow: function (stop) {
    if (!stop.meta) {
      return `<tr class="stop-header"><th ${colspan}>HSL:${stop.id}</th></tr>`;
    }
    const header = stop.name
      ? `${this.getStopNameWithVehicleMode(stop.meta)} - ${stop.name}`
      : this.getStopNameWithVehicleMode(stop.meta);
    return `<tr class="stop-header"><th ${colspan}>${header}</th></tr><tr class="stop-subheader"><td ${colspan}>${this.getSubheaderRow(
      stop.meta,
      stop.minutesFrom
    )}<td></tr>`;
  },

  getSubheaderRow: function (stop, minutesFrom) {
    const items =
      stop.locationType === "STOP"
        ? [
          stop.desc,
          `<span class="stop-code">${stop.code}</span>`,
          `<span class="stop-zone">${stop.zoneId}</span>`
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
    return items.reduce((p, c) => `${p} ${c}`, "");
  },

  getZoneId: function (zones) {
    if (!Array.isArray(zones)) {
      zones = [zones];
    }
    zones = [...new Set(zones)];
    return zones
      .map((zone) => `<span class="stop-zone">${zone}</span>`)
      .reduce((p, c) => `${p}${c}`, "");
  },

  getStopNameWithVehicleMode: function (data, includeId = undefined) {
    const name = includeId ? `${includeId} • ${data.name}` : data.name;
    if (!Array.isArray(data.vehicleMode)) {
      data.vehicleMode = [data.vehicleMode];
    }
    data.vehicleMode = [...new Set(data.vehicleMode)];
    return `${this.getVehicleModeIcon(data.vehicleMode)} ${name}`;
  },

  getVehicleModeIcon: function (vehicleModes) {
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
    return vehicleModes
      .map((mode) => `<i class="${map.get(mode)}"></i>`)
      .reduce((p, c) => `${p}${c}`, "");
  },

  getPlatformText: function (vehicleModes) {
    const defaultText = this.translate("PLATFORM");
    const map = new Map([
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
    ]);
    return vehicleModes
      .map((mode) => map.get(mode))
      .reduce((p, c) => `${p}${c}`, "");
  }
});
