// Based on code from Sami Mäkinen (https://github.com/ZakarFin)

const NOTIFICATION = {
  CANCELLED_TRIPS: {
    FETCH: "FETCH_CANCELLED_TRIPS",
    REJECT: "REJECT_CANCELLED_TRIPS",
    RESOLVE: "RESOLVE_CANCELLED_TRIPS"
  },
  CLUSTER_STOPTIMES: {
    FETCH: "FETCH_CLUSTER_STOPTIMES",
    REJECT: "REJECT_CLUSTER_STOPTIMES",
    RESOLVE: "RESOLVE_CLUSTER_STOPTIMES"
  },
  NOTIFICATION: { RESOLVE: "NOTIFICATION" },
  READY: { RESOLVE: "READY" },
  ROUTES: { RESOLVE: "RESOLVE_ROUTES" },
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
  STOPS: { RESOLVE: "RESOLVE_STOPS" }
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
      cancelledTrips: [1 * 1000, 5 * 1000, 100 * 1000, 20 * 1000, 60 * 1000],
      default: [1000 * 1000]
    },
    retry: [1 * 1000, 5 * 1000, 10 * 1000, 20 * 1000, 45 * 1000]
  },
  digitransitApiUrl:
    "https://api.digitransit.fi/routing/v1/routers/hsl/index/graphql",
  timeFormat: config.timeFormat === 24 ? "HH:mm" : "h:mm a",
  notifications: [],
  stoptimes: [],
  cancelledTrips: [],
  routes: {},
  stops: {},
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

  processCancelledTripsNotification: function (notification, payload) {
    const self = this;

    if (notification === NOTIFICATION.CANCELLED_TRIPS.RESOLVE) {
      const routes = this.routes;
      setTimeout(() => {
        self.sendSocketNotification(NOTIFICATION.CANCELLED_TRIPS.FETCH, routes);
      }, this.getNextInterval(this.intervals.update.cancelledTrips));
      this.cancelledTrips = payload.data;
      // payload.data?.forEach((item) => {
      // this.notify(
      //   `Service ${item.trip.routeShortName} to ${item.headsign} at ${moment(
      //     item.time
      //   ).format(this.timeFormat)} has been cancelled`,
      //   5
      // );
      // });
      return this.updateDom();
    }

    if (notification === NOTIFICATION.CANCELLED_TRIPS.REJECT) {
      const routes = this.routes;
      return setTimeout(() => {
        self.sendSocketNotification(NOTIFICATION.CANCELLED_TRIPS.FETCH, routes);
      }, this.getNextInterval(this.intervals.retry));
    }

    this.rejectSocketNotification(notification, payload);
  },

  processClusterStoptimesNotification: function (notification, payload) {
    const self = this;
    const { data, ...stop } = payload;

    if (notification === NOTIFICATION.CLUSTER_STOPTIMES.RESOLVE) {
      setTimeout(() => {
        self.sendSocketNotification(NOTIFICATION.CLUSTER_STOPTIMES.FETCH, stop);
      }, this.getNextInterval(this.intervals.update.default));
      return this.updateStoptime(payload);
    }

    if (notification === NOTIFICATION.CLUSTER_STOPTIMES.REJECT) {
      setTimeout(() => {
        self.sendSocketNotification(NOTIFICATION.CLUSTER_STOPTIMES.FETCH, stop);
      }, this.getNextInterval(this.intervals.retry));
      return this.rejectStoptime(payload.id);
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
      return this.updateStoptime(payload);
    }

    if (notification === NOTIFICATION.STOP_STOPTIMES.REJECT) {
      setTimeout(() => {
        self.sendSocketNotification(NOTIFICATION.STOP_STOPTIMES.FETCH, stop);
      }, this.getNextInterval(this.intervals.retry));
      return this.rejectStoptime(payload.id);
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
      this.sendSocketNotification(
        NOTIFICATION.CANCELLED_TRIPS.FETCH,
        this.routes
      );
      return this.config.stops
        .filter((stop) => !stop.disabled)
        .forEach((stop) => {
          const normalizedStop = {
            id: stop.id ?? stop,
            stopTimesCount: stop.stopTimesCount ?? this.config.stopTimesCount,
            ...stop
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

  processRoutesNotification: function (notification, payload) {
    if (notification === NOTIFICATION.ROUTES.RESOLVE) {
      return payload.forEach((item) => {
        this.routes[item.gtfsId] = { ...this.routes[item.gtfsId], ...item };
      });
    }

    this.rejectSocketNotification(notification, payload);
  },

  processStopsNotification: function (notification, payload) {
    if (notification === NOTIFICATION.STOPS.RESOLVE) {
      return payload.forEach((item) => {
        this.stops[item.gtfsId] = { ...this.stops[item.gtfsId], ...item };
      });
    }

    this.rejectSocketNotification(notification, payload);
  },

  processSearchStopNotification: function (notification, payload) {
    const self = this;
    const { data, ...stop } = payload;

    if (notification === NOTIFICATION.SEARCH_STOP.RESOLVE) {
      return this.updateStoptime(payload);
    }

    if (notification === NOTIFICATION.SEARCH_STOP.REJECT) {
      setTimeout(() => {
        self.sendSocketNotification(NOTIFICATION.SEARCH_STOP.FETCH, stop);
      }, this.getNextInterval(this.intervals.retry));
      return this.rejectStoptime(payload.id);
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
    if (this.checkSocketNotification(notification, NOTIFICATION.ROUTES)) {
      return this.processRoutesNotification(notification, payload);
    }
    if (this.checkSocketNotification(notification, NOTIFICATION.STOPS)) {
      return this.processStopsNotification(notification, payload);
    }
    if (
      this.checkSocketNotification(notification, NOTIFICATION.CANCELLED_TRIPS)
    ) {
      return this.processCancelledTripsNotification(notification, payload);
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

  updateStoptime: function (payload) {
    const index = this.stoptimes.findIndex(
      (stoptime) => stoptime.id === payload.id
    );
    this.stoptimes[index] = payload;
    this.updateDom();
  },

  rejectStoptime: function (id) {
    const index = this.stoptimes.findIndex((stoptime) => stoptime.id === id);
    this.stoptimes[index].data = { error: true };
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

  getTimeTable: function (index) {
    return this.stoptimes.at(index);
  },

  start: function () {
    Log.info(`Starting module: ${this.name}`);
    this.config.stops
      .filter((stop) => !stop.disabled)
      .forEach((stop) => {
        this.stoptimes.push({
          id: stop.id ?? stop,
          data: { empty: true }
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

    var large = document.createElement("div");
    large.className = "light small timetable";
    var htmlElements = [...this.stoptimes.keys()]
      .map((stop) => this.getTable(this.getTimeTable(stop)))
      .join('<tr><td title="getDom">&nbsp;</td></tr>');
    large.innerHTML = `${this.getNotifications()}<table>${this.getCancelledTripsHtml()}${this.getStops()}${htmlElements}</table>`;
    wrapper.appendChild(large);

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

  getStops: function () {
    const keys = Object.getOwnPropertyNames(this.stops);
    if (keys.length === 0) {
      return "";
    }
    return keys
      .map((key) =>
        [
          '<i class="fa-solid fa-s"></i>',
          this.stops[key].gtfsId,
          this.stops[key].parentStation?.gtfsId,
          this.stops[key].cluster?.gtfsId
        ]
          .map((column) => `<td>${column}</td>`)
          .join("")
      )
      .map((trip) => `<tr>${trip}</tr>`)
      .join("")
      .concat("<tr><td>&nbsp;</td></tr>");
  },

  getHeadsignForCancelledTrip: function (headsign) {
    const fullHeadsign = this.config.fullHeadsign || true;
    let [to, via] = headsign.split(" via ");
    [to] = to.split(" - ");
    if (via && fullHeadsign) {
      [via] = via.split(" - ");
    }
    return via && fullHeadsign ? `${to} via ${via}` : to;
  },

  getTable: function (stop) {
    if (!stop) {
      return `< span > ${this.translate("ERROR_SCHEDULE")}</span > `;
    }
    if (stop.disabled) {
      return "";
    }
    if (stop.data?.empty || stop.data?.error) {
      return `<tr class="stop-header"><th ${colspan}>HSL:${stop.id
        }</th></tr><tr><td ${colspan}>${stop.data?.error
          ? '<i class="fa-solid fa-xmark"></i> '
          : '<i class="fa-solid fa-spinner"></i> '
        }${this.translate(stop.data?.error ? "ERROR" : "LOADING")}</td></tr>`;
    }
    return stop.data.responseType === "STOP_SEARCH"
      ? this.getTableForStopSearch(stop)
      : this.getTableForTimetable(stop);
  },

  getTableForTimetable: function (stop) {
    const headerRow = `<tr class="stop-header"><th ${colspan}>${this.getHeaderRow(
      stop
    )}</th></tr><tr class="stop-subheader"><td ${colspan}>${this.getSubheaderRow(
      stop.data,
      stop.minutesFrom
    )}<td></tr>`;
    const rows = this.getStoptimes(stop)
      .map(
        (item) =>
          `<tr${item.cancelled
            ? ' class="cancelled-trip"'
            : item.until > 0
              ? ""
              : ' class="now"'
          }>${this.getRowForTimetable(stop, item)}</tr>`
      )
      .reduce((p, c) => `${p}${c}`, "");
    const stopAlerts = this.getSingleDimensionArray(
      stop.data.alerts,
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
    const stoptimes = this.getSingleDimensionArray(stop.data.stopTimes, "ts");
    if (stop.type === "cluster") {
      const cancelledTrips = Object.getOwnPropertyNames(this.stops)
        .filter((key) => this.stops[key].cluster.gtfsId === stop.id)
        .map((key) => this.stops[key].gtfsId)
        .map((gtfsId) => ({
          stopGtfsId: gtfsId,
          cancelledTrips: this.getCancelledTrips(gtfsId)
        }))
        .filter((stop) => stop.cancelledTrips.length)
        .forEach((stop) => {
          stop.cancelledTrips.forEach((trip) => {
            stoptimes.push(trip);
          });
        });
    } else {
      Log.error("No cluster", stop);
    }
    return stoptimes.sort((a, b) => moment(a.time).diff(moment(b.time)));
  },

  getCancelledTrips: function (stopGtfsId) {
    return this.cancelledTrips
      .map((trip) => {
        const t = trip.trip.stoptimes.filter(
          (stoptime) => stoptime.stop.gtfsId === stopGtfsId
        );
        const [stoptime] = t;
        return t.length > 0
          ? {
            headsign: stoptime.headsign,
            cancelled: true,
            line: trip.trip.routeShortName,
            time: stoptime.time
          }
          : undefined;
      })
      .filter((trip) => trip);
  },

  getCancelledTripsHtml: function () {
    if (this.cancelledTrips.length === 0) {
      return "";
    }
    return this.cancelledTrips
      .map((trip) =>
        [
          trip.trip.routeShortName,
          this.getHeadsignForCancelledTrip(trip.headsign),
          { value: '<i class="fa-solid fa-xmark"></i>', style: "time" },
          {
            value: moment(trip.time).format(this.timeFormat),
            style: "time"
          }
        ]
          .map(
            (column) =>
              `<td${column.style ? ` class="${column.style}"` : ""}>${column.value ?? column
              }</td>`
          )
          .join("")
      )
      .map((trip) => `<tr class="cancelled-trip">${trip}</tr>`)
      .join("")
      .concat("<tr><td>&nbsp;</td></tr>");
  },

  getRowForTimetable: function (stop, stoptime) {
    const columns = stoptime.cancelled
      ? this.getCancelledRow(stoptime)
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

  getCancelledRow: function (stoptime) {
    return [
      stoptime.line,
      this.getHeadsignForCancelledTrip(stoptime.headsign),
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
      stop.data.stops
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
    return item.until > 0
      ? `${realtimeIcon}${item.until} ${this.translate("MINUTES_ABBR")}`
      : `${realtimeIcon}${this.translate("NOW")}`;
  },

  getHeaderRow: function (stop) {
    return stop.name
      ? `${this.getStopNameWithVehicleMode(stop.data)} - ${stop.name}`
      : this.getStopNameWithVehicleMode(stop.data);
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
        `<span class="minutes-from">+${minutesFrom} ${this.translate(
          "MINUTES_ABBR"
        )}</span>`
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
