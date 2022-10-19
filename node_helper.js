/* eslint-disable jsdoc/require-jsdoc */
var moment = require("moment");
const fetch = require("node-fetch");
var NodeHelper = require("node_helper");
const getHSLStopTimesQuery = require("./HSL-graphiql/stop-times");
const getHSLStopSearchQuery = require("./HSL-graphiql/stop-search");

const nodeVersion = Number(process.version.match(/^v(\d+\.\d+)/)[1]);
const headers = {
  "Content-Type": "application/graphql",
  "User-Agent":
    "Mozilla/5.0 (Node.js " + nodeVersion + ") MagicMirror/" + global.version,
  "Cache-Control": "max-age=0, no-cache, no-store, must-revalidate",
  Pragma: "no-cache"
};

function getSchedule(baseUrl, stop, count, successCb, errorCB) {
  fetch(baseUrl, {
    method: "POST",
    body: getHSLStopTimesQuery(
      stop.type ?? "stop",
      stop.id || stop,
      count,
      moment().unix() + (stop.minutesFrom || 0) * 60
    ),
    headers: headers
  })
    .then(NodeHelper.checkFetchStatus)
    .then((response) => response.json())
    .then((json) => {
      if (!json.data) {
        errorCB("No data");
        return;
      }
      const data = stop.type ? json.data[stop.type] : json.data.stop;
      if (!data) {
        errorCB(`No ${stop.type ?? "stop"} data for ${stop.id || stop}`);
        return;
      }
      const response = {
        stopConfig: stop.id ? stop : undefined,
        stop: stop.id || stop,
        responseType: "TIMETABLE",
        name: data.name,
        vehicleMode: data.vehicleMode,
        desc: data.desc,
        code: data.code,
        platformCode: data.platformCode,
        zoneId: data.zoneId,
        alerts: data.alerts,
        locationType: data.locationType,
        stopTimes: processStopTimeData(data)
      };
      successCb(response);
    })
    .catch((error) => {
      errorCB(error);
    });
}

function getStopSearch(baseUrl, stop, successCb, errorCB) {
  fetch(baseUrl, {
    method: "POST",
    body: getHSLStopSearchQuery(stop),
    headers: headers
  })
    .then(NodeHelper.checkFetchStatus)
    .then((response) => response.json())
    .then((json) => {
      if (!json.data) {
        errorCB("No data");
        return;
      }
      const response = {
        stop: stop,
        responseType: "STOP_SEARCH",
        stops: json.data.stops
      };
      successCb(response);
    })
    .catch((error) => {
      errorCB(error);
    });
}

function processStopTimeData(json) {
  if (!json || json.length < 1) {
    return [];
  }
  let times = [];
  json.stoptimesWithoutPatterns.forEach((value) => {
    // times in seconds so multiple by 1000 for ms
    let datVal = new Date((value.serviceDay + value.realtimeDeparture) * 1000);
    const date = moment(datVal);
    const stopTime = {
      line: value.trip.routeShortName,
      headsign: value.headsign,
      alerts: value.trip.alerts,
      time: date.format("H:mm"),
      realtime: value.realtime,
      until: getUntil(date),
      ts: datVal.getTime()
    };
    times.push(stopTime);
  });
  return times;
}

const getUntil = (date) =>
  Math.floor(moment.duration(date.diff(moment())).asMinutes());

module.exports = NodeHelper.create({
  config: {},
  updateTimer: null,
  start: function () {
    moment.locale(config.language || "fi");
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "CONFIG") {
      this.config = payload;
      this.scheduleNextFetch(this.config.initialLoadDelay);
    }
  },

  fetchTimetables() {
    var self = this;
    this.config.stops.forEach((stop) => {
      if (stop.disabled) {
        return;
      }
      if (typeof stop === "string" && isNaN(stop)) {
        return getStopSearch(
          this.config.apiURL,
          stop,
          (data) => {
            self.sendSocketNotification("TIMETABLE", data);
            self.scheduleNextFetch(this.config.updateInterval);
          },
          (err) => {
            console.error(err);
            self.scheduleNextFetch(this.config.retryDelay);
          }
        );
      }
      getSchedule(
        this.config.apiURL,
        stop,
        stop.stopTimesCount ?? this.config.stopTimesCount,
        (data) => {
          self.sendSocketNotification("TIMETABLE", data);
          self.scheduleNextFetch(this.config.updateInterval);
        },
        (err) => {
          console.error(err);
          self.scheduleNextFetch(this.config.retryDelay);
        }
      );
    });
  },

  scheduleNextFetch: function (delay) {
    if (typeof delay === "undefined") {
      delay = 60 * 1000;
    }

    var self = this;
    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(function () {
      self.fetchTimetables();
    }, delay);
  }
});
