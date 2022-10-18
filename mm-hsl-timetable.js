/* global Module */

/* Magic Mirror
 * Module: mm-hsl-timetable
 *
 * Add this to config.js:

	{
		module: "mm-hsl-timetable",
		position: "top_right",
		header: "HSL aikataulu",
		config: {
			stops: [<STOP ID OR STOP OBJECT (SEE BELOW)>],
			stopTimesCount: 5,
			fontawesomeCode: "<CODE>", Get code from https://fontawesome.com (optional)
		}
	}

	Stop object:
	{
		id: 1130113
		name: Keskustaan
		minutesFrom: 5
	}

 *
 * By Sami Mäkinen http://github.com/zakarfin
 * MIT Licensed.
 */

Module.register("mm-hsl-timetable", {

	// Default module config.
	defaults: {
		stops: [1130113],
		stopTimesCount: 5,
		fontawesomeCode: undefined,

		initialLoadDelay: 0, // 0 seconds delay
		updateInterval: 50 * 1000, // every 50 seconds
		//updateInterval: 2 * 1000, // every 2 seconds
		retryDelay: 2500,

		apiURL: "https://api.digitransit.fi/routing/v1/routers/hsl/index/graphql",

		timetableClass: "timetable"
	},

	timeTable: {},

	notificationReceived: function (notification, payload, sender) {
		if (notification === "DOM_OBJECTS_CREATED") {
			this.sendSocketNotification("CONFIG", this.config);
		}
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "TIMETABLE") {
			// payload.stop name/id
			// payload.stopTimes array
			this.timeTable[payload.stop] = payload;
			this.loaded = true;
			this.updateDom();
		}
	},

	getStops() {
		return Object.keys(this.timeTable) || [];
	},

	getTimeTable(stop) {
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
		// Set locale.
		//moment.locale(config.language);
	},

	getDom: function () {
		var wrapper = document.createElement("div");

		if (!this.config.stops.length) {
			wrapper.innerHTML = "Please setup the stops in the config for module: " + this.name + ".";
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
		var htmlElements = this.getStops().map((stop) => this.getTable(this.getTimeTable(stop))
		).reduce((p, c) => `${p}<tr><td>&nbsp;</td></tr>${c}`, "<table>");
		large.innerHTML = `${htmlElements}</table>`;
		wrapper.appendChild(large);

		return wrapper;
	},

	getTable: function (data) {
		if (!data) {
			return "<span>Couldn't get schedule</span>";
		}
		colspan = "colspan=5";
		var headerRow = `<tr class="stop-header"><th ${colspan}>${this.getHeaderRow(data)}</th></tr><tr class="stop-subheader"><td ${colspan}>${this.getSubheaderRow(data)}<td></tr>`;
		var rows = data.stopTimes.map((item) => `<tr>${this.getRow(item)}</tr>`).reduce((p, c) => `${p}${c}`, "");
		var alerts = data.alerts.length > 0 ? data.alerts.map((alert) => `<tr ${colspan}><td>${this.getAlertIcon()} ${alert.alertHash}<td></tr>`) : "";
		return `${headerRow}${rows}${alerts}`;
	},

	getScripts: function () {
		return this.config.fontawesomeCode ? [`https://kit.fontawesome.com/${this.config.fontawesomeCode}.js`] : [];
	},

	getStyles: function () {
		return [this.file(`${this.name}.css`)];
	},

	getRow: function (item) {
		const columns = [item.line, item.alerts.length > 0 ? this.getAlertIcon() : "", item.headSign, { value: this.getUntilText(item), style: "time smaller" }, { value: item.time, style: "time" }];
		return columns.map((column) => `<td${typeof column.style !== 'undefined' ? ` class="${column.style}"` : ""}>${typeof column.value !== 'undefined' ? column.value : column}</td>`).reduce((p, c) => `${p}${c}`, "");
	},

	getUntilText: function (item) {
		if (item.until > 20) {
			return "";
		}
		const realtimeIcon = item.realtime ? "" : "~";
		return item.until > 0 ? `${realtimeIcon}${item.until} min` : `${realtimeIcon}Now`;
	},

	getHeaderRow: function (data) {
		return data.stopConfig?.name ? `${this.getStopNameWithVehicleMode(data)} - ${data.stopConfig.name}` : this.getStopNameWithVehicleMode(data);
	},

	getSubheaderRow: function (data) {
		const items = [data.desc, `<span class="stop-code">${data.code}</span>`, `<span class="stop-zone">${data.zoneId}</span>`];
		if (data.platformCode) {
			items.splice(2, 0, "Platform", `<span class="stop-platform">${data.platformCode}</span>`);
		}
		if (data.stopConfig?.minutesFrom) {
			items.push(`<span class="minutes-from">+${data.stopConfig.minutesFrom} min</span>`);
		}
		return items.reduce((p, c) => `${p} ${c}`, "");
	},

	getStopNameWithVehicleMode: function (item) {
		return this.config.fontawesomeCode ? `<i class="${this.getVehicleModeIcon(item.vehicleMode)}"></i> ${item.name}` : `${item.name} (${item.vehicleMode})`;
	},

	getVehicleModeIcon: function (vehicleMode) {
		// Vehicle modes according to HSL documentation
		return new Map([["AIRPLANE", "fa-solid fa-plane-up"],
		["BICYCLE", "fa-solid fa-bicycle"],
		["BUS", "fa-solid fa-bus-simple"],
		["CABLE_CAR", "fa-solid fa-cable-car"],
		["CAR", "fa-solid fa-car"],
		["FERRY", "fa-solid fa-ferry"],
		["FUNICULAR", "fa-solid fa-cable-car"], // No icon found for funicular
		["GONDOLA", "fa-solid fa-cable-car"], // A gondola (lift) should be the same as cable car
		["RAIL", "fa-solid fa-train"],
		["SUBWAY", "fa-solid fa-train-subway"],
		["TRAM", "fa-solid fa-train-tram"],
		]).get(vehicleMode);
	},

	getAlertIcon: function () {
		return this.config.fontawesomeCode ? '<i class="fa-solid fa-triangle-exclamation"></i>' : "!!!";
	}
});
