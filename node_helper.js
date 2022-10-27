/* eslint-disable jsdoc/require-jsdoc */
const moment = require("moment");
const fetch = require("node-fetch");
const NodeHelper = require("node_helper");
const getHSLStopTimesQuery = require("./HSL-graphiql/stop-times");
const getHSLStopSearchQuery = require("./HSL-graphiql/stop-search");
const Log = require("logger");
const { v4: uuidv4 } = require("uuid");

const processStopTimeData = (json) =>
  json.stoptimesWithoutPatterns.map((stoptime) => ({
    line: stoptime.trip.routeShortName,
    headsign: stoptime.headsign,
    remainingTime: getRemainingTime(getTime(stoptime)),
    time: getTime(stoptime),
    realtime: stoptime.realtime,
    cancelled: stoptime.realtimeState === "CANCELED",
    trip: {
      gtfsId: stoptime.trip.gtfsId,
      route: {
        gtfsId: stoptime.trip.route.gtfsId
      }
    }
  }));

const getTime = (stoptime) =>
  moment(
    (stoptime.serviceDay +
      (stoptime.realtimeDeparture ?? stoptime.scheduledDeparture)) *
    1000
  );

const getRemainingTime = (time) =>
  Math.round(moment.duration(time.diff(moment())).asMinutes());

module.exports = NodeHelper.create({
  initData: {
    core: undefined,
    instances: []
  },

  socketNotificationReceived: function (notification, payload) {
    const [instance, type] = notification.split("::");

    if (type === "CORE_INIT") {
      Log.log(instance, type);
      this.initData = { ...this.initData, ...payload, core: instance };
      return;
    }

    if (this.initData?.debug) {
      Log.log(instance, type, payload);
    }

    if (type === "INIT") {
      if (!this.initData?.instances.includes(instance)) {
        this.initData.instances.push(instance);
      }
      return this.sendInstanceSocketNotification(instance, "READY", undefined);
    }

    if (type === "WAKE_UP") {
      if (this.initData?.instances?.length) {
        return this.initData.instances.forEach((item) =>
          this.sendInstanceSocketNotification(item, "AWAKE", undefined)
        );
      }
      return this.sendInstanceSocketNotification(instance, "AWAKE", undefined);
    }

    if (type === "FETCH_STOP_STOPTIMES") {
      return this.getStopSchedule(
        payload,
        (data) => this.resolve(instance, "RESOLVE_STOP_STOPTIMES", data),
        (error) =>
          this.reject(error, instance, "REJECT_STOP_STOPTIMES", payload)
      );
    }

    if (type === "SEARCH_STOP") {
      return this.getStopSearch(
        payload,
        (data) => this.resolve(instance, "RESOLVE_SEARCH_STOP", data),
        (error) => this.reject(error, instance, "REJECT_SEARCH_STOP", payload)
      );
    }

    if (["NOTIFICATION", "API_KEY_NOTIFICATION"].includes(type)) {
      return this.sendInstanceSocketNotification(instance, type, {
        id: uuidv4(),
        ...payload
      });
    }

    Log.error(`Unhandled socket notification ${notification}`, payload);
    throw Error(`Unhandled socket notification ${notification}`);
  },

  sendInstanceSocketNotification: function (instance, notification, payload) {
    this.sendSocketNotification(`${instance}::${notification}`, payload);
  },

  resolve: function (instance, notification, data) {
    this.sendInstanceSocketNotification(instance, notification, data);
  },

  reject: function (error, instance, notification, payload) {
    Log.error(error);
    this.sendInstanceSocketNotification(instance, notification, payload);
    if (!this.initData?.digiTransit) {
      if (this.initData?.instances && this.initData.instances.length) {
        this.initData.instances.forEach((item) => {
          this.sendInstanceSocketNotification(item, "FEED", undefined);
        });
      } else {
        this.sendInstanceSocketNotification(instance, "FEED", undefined);
      }
    }
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
    try {
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
    } catch (error) {
      return reject(error);
    }
  },

  getStopSchedule: function (stop, resolve, reject) {
    try {
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
    } catch (error) {
      return reject(error);
    }
  }
});
