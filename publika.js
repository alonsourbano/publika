// Based on code from Sami Mäkinen (https://github.com/ZakarFin)

Module.register("publika", {
  defaults: {
    stops: [],
    stopTimesCount: 5,
    fontawesomeCode: undefined,

    initialLoadDelay: 0 * 1000, // N seconds delay
    updateInterval: 20 * 1000, // every N seconds
    retryDelay: 50 * 1000, // every N seconds

    apiURL: "https://api.digitransit.fi/routing/v1/routers/hsl/index/graphql",

    timetableClass: "timetable"
  },

  timeTable: [],

  notificationReceived: function (notification, payload, sender) {
    if (sender) {
      if (sender.name !== "clock") {
        Log.log(
          `${this.name} received a module notification: ${notification} from sender: ${sender.name}`
        );
        Log.log(payload);
      }
    } else {
      Log.log(`${this.name} received a module notification: ${notification}`);
      Log.log(payload);
    }
    if (notification === "DOM_OBJECTS_CREATED") {
      this.sendSocketNotification("CONFIG", this.config);
    }
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "TIMETABLE") {
      const index = this.timeTable.findIndex(
        (stop) => stop.stop === payload.stop
      );
      this.timeTable[index] = payload;
      this.loaded = true;
      this.updateDom();
    }
  },

  getStops: function () {
    return Object.keys(this.timeTable) || [];
  },

  getTranslations: function () {
    return {
      en: "translations/en.json",
      fi: "translations/fi.json",
      sv: "translations/sv.json"
    };
  },

  getScripts: function () {
    return this.config.fontawesomeCode
      ? [`https://kit.fontawesome.com/${this.config.fontawesomeCode}.js`]
      : [];
  },

  getStyles: function () {
    return [this.file(`${this.name}.css`)];
  },

  getTimeTable: function (stop) {
    // stop might be object with id and name
    var id = stop.id || stop;
    if (typeof id !== "number" && typeof id !== "string") {
      return null;
    }
    var details = this.timeTable[id];
    if (!details) {
      return null;
    }
    return details;
  },

  start: function () {
    Log.info("Starting module: " + this.name);
    this.config.stops.forEach((stop) => {
      this.timeTable.push({
        stop: stop.id ?? stop,
        empty: true,
        disabled: stop.disabled
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
      .reduce((p, c) => `${p}<tr><td>&nbsp;</td></tr>${c}`, "<table>");
    large.innerHTML = `${htmlElements}</table>`;
    wrapper.appendChild(large);

    return wrapper;
  },

  colspan: "colspan=4",

  getTable: function (stop) {
    if (!stop) {
      return `<span>${this.translate("ERROR_SCHEDULE")}</span>`;
    }
    if (stop.disabled) {
      return "";
    }
    if (stop.empty) {
      return `<tr class="stop-header"><th ${this.colspan}>HSL:${stop.stop
        }</th></tr><tr><td ${this.colspan}>${this.translate(
          "LOADING"
        )}</td></tr>`;
    }
    if (stop.responseType === "TIMETABLE") {
      return this.getTableForTimetable(stop);
    }
    return this.getTableForStopSearch(stop);
  },

  getTableForTimetable: function (stop) {
    var headerRow = `<tr class="stop-header"><th ${this.colspan
      }>${this.getHeaderRow(stop)}</th></tr><tr class="stop-subheader"><td ${this.colspan
      }>${this.getSubheaderRow(stop)}<td></tr>`;
    var rows = this.getSingleDimensionArray(stop.stopTimes, "ts")
      .map((item) => `<tr>${this.getRowForTimetable(item)}</tr>`)
      .reduce((p, c) => `${p}${c}`, "");
    const stopAlerts = this.getSingleDimensionArray(
      stop.alerts,
      "effectiveStartDate"
    );
    var alerts =
      stopAlerts.length > 0
        ? stopAlerts.map(
          (alert) =>
            `<tr><td ${this.colspan}>${this.getAlertIcon()} ${alert.alertHash
            }<td></tr>`
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

  getRowForTimetable: function (item) {
    const columns = [
      item.line,
      this.getHeadsign(item),
      { value: this.getUntilText(item), style: "time smaller" },
      { value: item.time, style: "time" }
    ];
    return columns
      .map(
        (column) =>
          `<td${column.style ? ` class="${column.style}"` : ""}>${column.value ?? column
          }</td>`
      )
      .reduce((p, c) => `${p}${c}`, "");
  },

  getHeadsign: function (item) {
    const headsign = item.headsign?.includes(" via ")
      ? item.headsign.split(" via ").at(0)
      : item.headsign;
    return item.alerts.length > 0
      ? `${this.getAlertIcon()} ${headsign}`
      : headsign;
  },

  getTableForStopSearch: function (stop) {
    var headerRow = `<tr class="stop-header"><th ${this.colspan}>${this.config.fontawesomeCode
        ? '<i class="fa-solid fa-magnifying-glass"></i> '
        : ""
      }${stop.stop}</th></tr>`;
    var rows = stop.stops
      .map(
        (item) =>
          `<tr><td ${this.colspan}>${this.getStopNameWithVehicleMode(
            item,
            item.gtfsId.split(":").at(1)
          )}</td></tr><tr class="stop-subheader"><td ${this.colspan
          }>${this.getSubheaderRow(
            item
          )}</td></tr><tr class="stop-subheader"><td ${this.colspan
          }>${this.translate("STATION")}: ${item.parentStation.gtfsId
            .split(":")
            .at(1)} • ${item.parentStation.name
          }</td></tr><tr class="stop-subheader"><td ${this.colspan
          }>${this.translate("CLUSTER")}: ${item.cluster.gtfsId} • ${item.cluster.name
          }</td></tr><tr><td>&nbsp;</td></tr>`
      )
      .reduce((p, c) => `${p}${c}`, "");
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
    return stop.stopConfig?.name
      ? `${this.getStopNameWithVehicleMode(stop)} - ${stop.stopConfig.name}`
      : this.getStopNameWithVehicleMode(stop);
  },

  getSubheaderRow: function (stop) {
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
    if (stop.stopConfig?.minutesFrom) {
      items.push(
        `<span class="minutes-from">+${stop.stopConfig.minutesFrom
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

  getStopNameWithVehicleMode: function (item, includeId = undefined) {
    const name = includeId ? `${includeId} • ${item.name}` : item.name;
    if (!Array.isArray(item.vehicleMode)) {
      item.vehicleMode = [item.vehicleMode];
    }
    item.vehicleMode = [...new Set(item.vehicleMode)];
    return this.config.fontawesomeCode
      ? `${this.getVehicleModeIcon(item.vehicleMode)} ${name}`
      : `${name} (${this.getVehicleModeText(item.vehicleMode)})`;
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

  getVehicleModeText: function (vehicleModes) {
    return vehicleModes
      .map((mode) => this.translate(mode))
      .reduce((p, c) => `${p}, ${c}`, "");
  },

  getAlertIcon: function () {
    return this.config.fontawesomeCode
      ? '<i class="fa-solid fa-triangle-exclamation"></i>'
      : "!!!";
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
