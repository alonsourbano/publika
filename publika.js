// Based on code from Sami Mäkinen (https://github.com/ZakarFin)

Module.register("publika", {
  defaults: {
    stops: [],
    stopTimesCount: 5,
    hslApiKey: undefined,

    updateInterval: 20 * 1000, // every N seconds
    retryInterval: 45 * 1000, // every N seconds
    digitransitApiUrl:
      "https://api.digitransit.fi/routing/v1/routers/hsl/index/graphql",
    timetableClass: "timetable",
    timeFormat: config.timeFormat === 24 ? "HH:mm" : "h:mm a"
  },

  notifications: [],
  stoptimes: [],
  colspan: 'colspan="4"',
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

  socketNotificationReceived: function (notification, payload) {
    const self = this;
    const notifications = {
      FETCH_CLUSTER_STOPTIMES: "FETCH_CLUSTER_STOPTIMES",
      FETCH_STOP_STOPTIMES: "FETCH_STOP_STOPTIMES",
      NOTIFICATION: "NOTIFICATION",
      READY: "READY",
      REJECT_CLUSTER_STOPTIMES: "REJECT_CLUSTER_STOPTIMES",
      REJECT_SEARCH_STOP: "REJECT_SEARCH_STOP",
      REJECT_STOP_STOPTIMES: "REJECT_STOP_STOPTIMES",
      RESOLVE_CLUSTER_STOPTIMES: "RESOLVE_CLUSTER_STOPTIMES",
      RESOLVE_SEARCH_STOP: "RESOLVE_SEARCH_STOP",
      RESOLVE_STOP_STOPTIMES: "RESOLVE_STOP_STOPTIMES",
      SEARCH_STOP: "SEARCH_STOP"
    };
    if (notification === notifications.READY) {
      this.loaded = true;
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
              notifications.FETCH_CLUSTER_STOPTIMES,
              normalizedStop
            );
          }
          if (typeof stop === "string" && isNaN(stop)) {
            return this.sendSocketNotification(
              notifications.SEARCH_STOP,
              normalizedStop
            );
          }
          return this.sendSocketNotification(
            notifications.FETCH_STOP_STOPTIMES,
            normalizedStop
          );
        });
    }

    const { data, ...stop } = payload;

    if (notification === notifications.RESOLVE_SEARCH_STOP) {
      return this.updateStoptime(payload);
    }

    if (notification === notifications.REJECT_SEARCH_STOP) {
      setTimeout(() => {
        self.sendSocketNotification(notifications.SEARCH_STOP, stop);
      }, this.config.retryInterval);
      return this.rejectStoptime(payload.id);
    }

    if (notification === notifications.RESOLVE_CLUSTER_STOPTIMES) {
      setTimeout(() => {
        self.sendSocketNotification(
          notifications.FETCH_CLUSTER_STOPTIMES,
          stop
        );
      }, this.config.updateInterval);
      return this.updateStoptime(payload);
    }

    if (notification === notifications.REJECT_CLUSTER_STOPTIMES) {
      setTimeout(() => {
        self.sendSocketNotification(
          notifications.FETCH_CLUSTER_STOPTIMES,
          stop
        );
      }, this.config.retryInterval);
      return this.rejectStoptime(payload.id);
    }

    if (notification === notifications.RESOLVE_STOP_STOPTIMES) {
      setTimeout(() => {
        self.sendSocketNotification(notifications.FETCH_STOP_STOPTIMES, stop);
      }, this.config.updateInterval);
      return this.updateStoptime(payload);
    }

    if (notification === notifications.REJECT_STOP_STOPTIMES) {
      setTimeout(() => {
        self.sendSocketNotification(notifications.FETCH_STOP_STOPTIMES, stop);
      }, this.config.retryInterval);
      return this.rejectStoptime(payload.id);
    }

    if (notification === notifications.NOTIFICATION) {
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
            this.notifications = this.notifications.filter(
              (item) => item.id !== payload.id
            );
            this.updateDom();
          }, payload.timer);
          this.updateDom();
        }
      }
      return;
    }

    Log.error(`Unhandled socket notification ${notification}`, payload);
    throw Error(`Unhandled socket notification ${notification}`);
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
        apiUrl: this.config.digitransitApiUrl
      }
    });
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

  getStops: function () {
    return Object.keys(this.stoptimes) || [];
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
      wrapper.innerHTML = `${this.translate("SETUP_MODULE")}${this.name}.`;
      wrapper.className = "dimmed light small";
      return wrapper;
    }

    if (!this.loaded) {
      wrapper.innerHTML = this.translate("LOADING");
      wrapper.className = "dimmed light small";
      return wrapper;
    }

    var large = document.createElement("div");
    large.className = "light small " + this.config.timetableClass;
    var htmlElements = this.getStops()
      .map((stop) => this.getTable(this.getTimeTable(stop)))
      .join('<tr><td title="getDom">&nbsp;</td></tr>');
    large.innerHTML = `${this.getNotifications()}<table>${htmlElements}</table>`;
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
          `<tr><td colspan="${this.colspan}">${notification.message}</td></tr>`
      )
      .reduce((p, c) => `${p}${c}`, "");
    return `<div class="notification"><table>${notifications}</table></div>`;
  },

  getTable: function (stop) {
    if (!stop) {
      return `<span>${this.translate("ERROR_SCHEDULE")}</span>`;
    }
    if (stop.disabled) {
      return "";
    }
    if (stop.data?.empty || stop.data?.error) {
      return `<tr class="stop-header"><th ${this.colspan}>HSL:${stop.id
        }</th></tr><tr><td ${this.colspan}>${stop.data?.error
          ? '<i class="fa-solid fa-xmark"></i> '
          : '<i class="fa-solid fa-spinner"></i> '
        }${this.translate(stop.data?.error ? "ERROR" : "LOADING")}</td></tr>`;
    }
    return stop.data.responseType === "STOP_SEARCH"
      ? this.getTableForStopSearch(stop)
      : this.getTableForTimetable(stop);
  },

  getTableForTimetable: function (stop) {
    var headerRow = `<tr class="stop-header"><th ${this.colspan
      }>${this.getHeaderRow(stop)}</th></tr><tr class="stop-subheader"><td ${this.colspan
      }>${this.getSubheaderRow(stop.data, stop.minutesFrom)}<td></tr>`;
    var rows = this.getSingleDimensionArray(stop.data.stopTimes, "ts")
      .map(
        (item) =>
          `<tr${item.until > 0 ? "" : ' class="now"'}>${this.getRowForTimetable(
            item
          )}</tr>`
      )
      .reduce((p, c) => `${p}${c}`, "");
    const stopAlerts = this.getSingleDimensionArray(
      stop.data.alerts,
      "effectiveStartDate"
    );
    var alerts =
      stopAlerts.length > 0
        ? stopAlerts.map(
          (alert) =>
            `<tr><td ${this.colspan}><i class="fa-solid fa-triangle-exclamation"></i> ${alert.alertHash}<td></tr>`
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

  getRowForTimetable: function (data) {
    const columns = [
      data.line,
      this.getHeadsign(data),
      { value: this.getUntilText(data), style: "time smaller" },
      { value: moment(data.time).format(this.config.timeFormat), style: "time" }
    ];
    return columns
      .map(
        (column) =>
          `<td${column.style ? ` class="${column.style}"` : ""}>${column.value ?? column
          }</td>`
      )
      .reduce((p, c) => `${p}${c}`, "");
  },

  getHeadsign: function (data) {
    const headsign = data.headsign?.includes(" via ")
      ? data.headsign.split(" via ").at(0)
      : data.headsign;
    return data.alerts.length > 0
      ? `<i class="fa-solid fa-triangle-exclamation"></i> ${headsign}`
      : headsign;
  },

  getTableForStopSearch: function (stop) {
    var headerRow = `<tr class="stop-header"><th ${this.colspan}><i class="fa-solid fa-magnifying-glass"></i> ${stop.id}</th></tr>`;
    var rows =
      stop.data.stops
        .map(
          (item) =>
            `<tr><td ${this.colspan}>${this.getStopNameWithVehicleMode(
              item,
              item.gtfsId.split(":").at(1)
            )}</td></tr><tr class="stop-subheader"><td ${this.colspan
            }>${this.getSubheaderRow(
              item,
              stop.minutesFrom
            )}</td></tr><tr class="stop-subheader"><td ${this.colspan
            }>${this.translate("STATION")}: ${item.parentStation.gtfsId
              .split(":")
              .at(1)} • ${item.parentStation.name
            }</td></tr><tr class="stop-subheader"><td ${this.colspan
            }>${this.translate("CLUSTER")}: ${item.cluster.gtfsId} • ${item.cluster.name
            }</td></tr>`
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
