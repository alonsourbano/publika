/* eslint-disable jsdoc/require-jsdoc */
const moment = require("moment");
const fetch = require("node-fetch");
const NodeHelper = require("node_helper");
const getHSLStopTimesQuery = require("./HSL-graphiql/stop-times");
const getHSLClusterTimesQuery = require("./HSL-graphiql/cluster-times");
const getHSLStopSearchQuery = require("./HSL-graphiql/stop-search");
const Log = require("logger");
const { v4: uuidv4 } = require("uuid");

const processStopTimeData = (json) =>
  json.stoptimesWithoutPatterns.map((value) => {
    const time = getTime(value);
    return {
      line: value.trip.routeShortName,
      headsign: value.headsign,
      until: getUntil(time),
      time,
      realtime: value.realtime,
      cancelled: value.realtimeState === "CANCELED",
      trip: {
        gtfsId: value.trip.gtfsId,
        route: {
          gtfsId: value.trip.route.gtfsId
        }
      }
    };
  });

const getTime = (stoptime) =>
  moment(
    (stoptime.serviceDay +
      (stoptime.realtimeDeparture ?? stoptime.scheduledDeparture)) *
    1000
  );

const getUntil = (date) =>
  Math.round(moment.duration(date.diff(moment())).asMinutes());

module.exports = NodeHelper.create({
  initData: {},

  socketNotificationReceived: function (notification, payload) {
    if (this.initData?.debug) {
      Log.log(notification, payload);
    }
    const self = this;

    if (notification === "INIT") {
      this.initData = payload;
      return this.sendSocketNotification("READY", undefined);
    }

    if (notification === "FETCH_STOP_STOPTIMES") {
      return this.getStopSchedule(
        payload,
        (data) => {
          self.sendSocketNotification("RESOLVE_STOP_STOPTIMES", data);
        },
        (error) => {
          Log.error(error);
          self.sendSocketNotification("REJECT_STOP_STOPTIMES", payload);
        }
      );
    }

    if (notification === "FETCH_CLUSTER_STOPTIMES") {
      return this.getClusterSchedule(
        payload,
        (data) => {
          self.sendSocketNotification("RESOLVE_CLUSTER_STOPTIMES", data);
        },
        (error) => {
          Log.error(error);
          self.sendSocketNotification("REJECT_CLUSTER_STOPTIMES", payload);
        }
      );
    }

    if (notification === "SEARCH_STOP") {
      return this.getStopSearch(
        payload,
        (data) => {
          self.sendSocketNotification("RESOLVE_SEARCH_STOP", data);
        },
        (error) => {
          Log.error(error);
          self.sendSocketNotification("REJECT_SEARCH_STOP", payload);
        }
      );
    }

    if (notification === "NOTIFICATION") {
      return this.sendSocketNotification("NOTIFICATION", {
        id: uuidv4(),
        ...payload
      });
    }

    Log.error(`Unhandled socket notification ${notification}`, payload);
    throw Error(`Unhandled socket notification ${notification}`);
  },

  getHeaders: function () {
    return {
      "Content-Type": "application/graphql",
      "User-Agent":
        "Mozilla/5.0 (Node.js " +
        Number(process.version.match(/^v(\d+\.\d+)/)[1]) +
        ") MagicMirror/" +
        global.version,
      "Cache-Control": "max-age=0, no-cache, no-store, must-revalidate",
      "digitransit-subscription-key": this.initData.digiTransit.subscriptionKey,
      Pragma: "no-cache"
    };
  },

  getStopSearch: function (stop, resolve, reject) {
    fetch(this.initData.digiTransit.apiUrl, {
      method: "POST",
      body: getHSLStopSearchQuery(stop.id),
      headers: this.getHeaders()
    })
      .then(NodeHelper.checkFetchStatus)
      .then((response) => response.json())
      .then((json) => {
        if (json.data) {
          return resolve({
            ...stop,
            data: {
              responseType: "STOP_SEARCH",
              stops: json.data.stops
            }
          });
        }
        return reject("No data");
      })
      .catch((error) => reject(error));
  },

  getClusterSchedule: function (stop, resolve, reject) {
    fetch(this.initData.digiTransit.apiUrl, {
      method: "POST",
      body: getHSLClusterTimesQuery(
        stop.id,
        stop.stopTimesCount,
        moment().unix() + (stop.minutesFrom || 0) * 60
      ),
      headers: this.getHeaders()
    })
      .then(NodeHelper.checkFetchStatus)
      .then((response) => response.json())
      .then((json) => {
        if (!json.data) {
          return reject("No data");
        }
        const data = json.data.cluster;
        if (!data) {
          return reject(`No cluster data for ${stop.id}`);
        }
        if (!(data.stops && data.stops.length > 0)) {
          return reject(`Cluster ${stop.id} has no stop data`);
        }
        return resolve({
          ...stop,
          data: {
            responseType: "TIMETABLE",
            name: data.name,
            vehicleMode: data.stops
              .map((item) => item.vehicleMode)
              .reduce((p, c) => [...p, c], []),
            zoneId: data.stops
              .map((item) => item.zoneId)
              .reduce((p, c) => [...p, c], []),
            alerts: data.stops
              .map((item) => item.alerts)
              .reduce((p, c) => [...p, ...c], []),
            locationType: "CLUSTER",
            stopTimes: data.stops
              .map((item) => processStopTimeData(item))
              .reduce((p, c) => [...p, ...c], [])
              .sort((a, b) => moment(a.time).diff(moment(b.time)))
          }
        });
      })
      .catch((error) => reject(error));
  },

  getStopSchedule: function (stop, resolve, reject) {
    fetch(this.initData.digiTransit.apiUrl, {
      method: "POST",
      body: getHSLStopTimesQuery(
        stop.type ?? "stop",
        stop.id,
        stop.stopTimesCount,
        moment().unix() + (stop.minutesFrom || 0) * 60
      ),
      headers: this.getHeaders()
    })
      .then(NodeHelper.checkFetchStatus)
      .then((response) => response.json())
      .then((json) => {
        if (!json.data) {
          return reject("No data");
        }
        const data = stop.type ? json.data[stop.type] : json.data.stop;
        if (!data) {
          return reject(`No ${stop.type ?? "stop"} data for ${stop.id}`);
        }
        return resolve({
          ...stop,
          data: {
            responseType: "TIMETABLE",
            gtfsId: data.gtfsId,
            name: data.name,
            vehicleMode: data.vehicleMode,
            desc: data.desc,
            code: data.code,
            platformCode: data.platformCode,
            zoneId: data.zoneId,
            locationType: data.locationType,
            stopTimes: processStopTimeData(data),
            alerts: [
              ...data.alerts,
              ...data.routes
                .map((route) => route.alerts)
                .reduce((p, c) => [...p, ...c], []),
              ...data.stops
                .map((stop) => stop.alerts)
                .reduce((p, c) => [...p, ...c], []),
              ...data.stops
                .map((stop) =>
                  stop.routes
                    .map((route) => route.alerts)
                    .reduce((p, c) => [...p, ...c], [])
                )
                .reduce((p, c) => [...p, ...c], []),
              ...data.stoptimesWithoutPatterns
                .map((stoptime) => stoptime.trip.alerts)
                .reduce((p, c) => [...p, ...c], []),
              ...data.stoptimesWithoutPatterns
                .map((stoptime) => stoptime.trip.route.alerts)
                .reduce((p, c) => [...p, ...c], [])
            ]
              .map((alert) => ({
                startTime: moment(alert.effectiveStartDate * 1000),
                endTime: moment(alert.effectiveEndDate * 1000),
                ...alert
              }))
              .sort((a, b) => moment(a.endTime).diff(moment(b.endTime)))
              .sort((a, b) => moment(a.startTime).diff(moment(b.startTime)))
          }
        });
      })
      .catch((error) => reject(error));
  }
});
