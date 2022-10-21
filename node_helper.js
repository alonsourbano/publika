/* eslint-disable jsdoc/require-jsdoc */
const moment = require("moment");
const fetch = require("node-fetch");
const NodeHelper = require("node_helper");
const getHSLStopTimesQuery = require("./HSL-graphiql/stop-times");
const getHSLClusterTimesQuery = require("./HSL-graphiql/cluster-times");
const getHSLStopSearchQuery = require("./HSL-graphiql/stop-search");
const Log = require("logger");
const { v4: uuidv4 } = require("uuid");

var self = undefined;
var selfConfig = undefined;

function getHeaders() {
  return {
    "Content-Type": "application/graphql",
    "User-Agent":
      "Mozilla/5.0 (Node.js " +
      Number(process.version.match(/^v(\d+\.\d+)/)[1]) +
      ") MagicMirror/" +
      global.version,
    "Cache-Control": "max-age=0, no-cache, no-store, must-revalidate",
    "digitransit-subscription-key": selfConfig.hslApiKey,
    Pragma: "no-cache"
  };
}

function getStopSchedule(baseUrl, stop, count, successCb, errorCB) {
  fetch(baseUrl, {
    method: "POST",
    body: getHSLStopTimesQuery(
      stop.type ?? "stop",
      stop.id || stop,
      count,
      moment().unix() + (stop.minutesFrom || 0) * 60
    ),
    headers: getHeaders()
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
    headers: getHeaders()
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

function getClusterSchedule(baseUrl, stop, count, successCb, errorCB) {
  fetch(baseUrl, {
    method: "POST",
    body: getHSLClusterTimesQuery(
      stop.id,
      count,
      moment().unix() + (stop.minutesFrom || 0) * 60
    ),
    headers: getHeaders()
  })
    .then(NodeHelper.checkFetchStatus)
    .then((response) => response.json())
    .then((json) => {
      if (!json.data) {
        errorCB("No data");
        return;
      }
      const data = json.data.cluster;
      if (!data) {
        errorCB(`No cluster data for ${stop.id}`);
        return;
      }
      if (!(data.stops && data.stops.length > 0)) {
        errorCB(`Cluster ${stop.id} has no stop data`);
        return;
      }
      const response = {
        stopConfig: stop,
        stop: stop.id,
        responseType: "TIMETABLE",
        name: data.name,
        vehicleMode: data.stops.map((item) => item.vehicleMode),
        zoneId: data.stops.map((item) => item.zoneId),
        alerts: data.stops.map((item) => item.alerts),
        locationType: "CLUSTER",
        stopTimes: data.stops.map((item) => processStopTimeData(item))
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
  Math.round(moment.duration(date.diff(moment())).asMinutes());

const success = (data) => {
  self.sendSocketNotification("PUBLIKA:TIMETABLE", data);
  self.scheduleNextFetch(selfConfig.updateInterval);
};

const error = (err) => {
  Log.error(err);
  self.scheduleNextFetch(selfConfig.retryDelay);
};

module.exports = NodeHelper.create({
  config: {},
  updateTimer: null,
  start: function () {
    moment.locale(config.language || "fi");
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "PUBLIKA:CONFIG") {
      this.config = payload;
      this.scheduleNextFetch(this.config.initialLoadDelay);
    } else if (notification === "PUBLIKA:NOTIFICATION") {
      payload.id = uuidv4();
      this.sendSocketNotification("PUBLIKA:NOTIFICATION", payload);
    }
  },

  fetchTimetables() {
    self = this;
    selfConfig = this.config;
    this.config.stops.forEach((stop) => {
      if (stop.disabled) {
        return;
      }
      if (typeof stop === "string" && isNaN(stop)) {
        return getStopSearch(this.config.apiURL, stop, success, error);
      }
      if (stop.type === "cluster") {
        return getClusterSchedule(
          this.config.apiURL,
          stop,
          stop.stopTimesCount ?? this.config.stopTimesCount,
          success,
          error
        );
      }
      getStopSchedule(
        this.config.apiURL,
        stop,
        stop.stopTimesCount ?? this.config.stopTimesCount,
        success,
        error
      );
    });
  },

  scheduleNextFetch: function (delay) {
    if (typeof delay === "undefined") {
      delay = 60 * 1000;
    }

    const self = this;
    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(function () {
      self.fetchTimetables();
    }, delay);
  }
});
