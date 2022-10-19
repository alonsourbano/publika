Module.register("publika", {
  defaults: {
    stops: [],
    stopTimesCount: 5,
    fontawesomeCode: undefined,

    initialLoadDelay: 0 * 1000, // 0 seconds delay
    updateInterval: 20 * 1000, // every 20 seconds
    retryDelay: 5 * 1000, // every 20 seconds

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
      }
    } else {
      Log.log(`${this.name} received a module notification: ${notification}`);
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
      this.timeTable.push({ stop: stop.id ?? stop, empty: true });
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

  getTable: function (data) {
    if (!data) {
      return `<span>${this.translate("ERROR_SCHEDULE")}</span>`;
    }
    const colspan = "colspan=5";
    if (data.empty) {
      return `<tr class="stop-header"><th ${colspan}>HSL:${data.stop
        }</th></tr><tr><td ${colspan}>${this.translate("LOADING")}</td></tr>`;
    }
    var headerRow = `<tr class="stop-header"><th ${colspan}>${this.getHeaderRow(
      data
    )}</th></tr><tr class="stop-subheader"><td ${colspan}>${this.getSubheaderRow(
      data
    )}<td></tr>`;
    var rows = data.stopTimes
      .map((item) => `<tr>${this.getRow(item)}</tr>`)
      .reduce((p, c) => `${p}${c}`, "");
    var alerts =
      data.alerts.length > 0
        ? data.alerts.map(
          (alert) =>
            `<tr ${colspan}><td>${this.getAlertIcon()} ${alert.alertHash
            }<td></tr>`
        )
        : "";
    return `${headerRow}${rows}${alerts}`;
  },

  getScripts: function () {
    return this.config.fontawesomeCode
      ? [`https://kit.fontawesome.com/${this.config.fontawesomeCode}.js`]
      : [];
  },

  getStyles: function () {
    return [this.file(`${this.name}.css`)];
  },

  getRow: function (item) {
    const columns = [
      item.line,
      item.alerts.length > 0 ? this.getAlertIcon() : "",
      item.headSign,
      { value: this.getUntilText(item), style: "time smaller" },
      { value: item.time, style: "time" }
    ];
    return columns
      .map(
        (column) =>
          `<td${typeof column.style !== "undefined"
            ? ` class="${column.style}"`
            : ""
          }>${typeof column.value !== "undefined" ? column.value : column}</td>`
      )
      .reduce((p, c) => `${p}${c}`, "");
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

  getHeaderRow: function (data) {
    return data.stopConfig?.name
      ? `${this.getStopNameWithVehicleMode(data)} - ${data.stopConfig.name}`
      : this.getStopNameWithVehicleMode(data);
  },

  getSubheaderRow: function (data) {
    const items =
      data.locationType === "STATION"
        ? [
          `<span class="stop-code">${this.translate("STATION")}</span>`,
          `<span class="stop-zone">${data.zoneId}</span>`
        ]
        : [
          data.desc,
          `<span class="stop-code">${data.code}</span>`,
          `<span class="stop-zone">${data.zoneId}</span>`
        ];
    if (data.platformCode) {
      items.splice(
        2,
        0,
        this.getPlatformText(data.vehicleMode),
        `<span class="stop-platform">${data.platformCode}</span>`
      );
    }
    if (data.stopConfig?.minutesFrom) {
      items.push(
        `<span class="minutes-from">+${data.stopConfig.minutesFrom
        } ${this.translate("MINUTES_ABBR")}</span>`
      );
    }
    return items.reduce((p, c) => `${p} ${c}`, "");
  },

  getStopNameWithVehicleMode: function (item) {
    return this.config.fontawesomeCode
      ? `<i class="${this.getVehicleModeIcon(item.vehicleMode)}"></i> ${item.name
      }`
      : `${item.name} (${item.vehicleMode})`;
  },

  getVehicleModeIcon: function (vehicleMode) {
    // Vehicle modes according to HSL documentation
    return new Map([
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
    ]).get(vehicleMode);
  },

  getAlertIcon: function () {
    return this.config.fontawesomeCode
      ? '<i class="fa-solid fa-triangle-exclamation"></i>'
      : "!!!";
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
