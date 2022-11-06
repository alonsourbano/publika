/* eslint-disable jsdoc/require-jsdoc */
const moment = require("moment");
const fetch = require("node-fetch");
const NodeHelper = require("node_helper");
const getStopTimesQuery = require("./graphiql/stop-times");
const getHSLStopSearchQuery = require("./graphiql/stop-search");
const getHSLBikeStationQuery = require("./graphiql/bike-station");
const Log = require("logger");
const { v4: uuidv4 } = require("uuid");

const processStopTimeData = (stoptimesWithoutPatterns) =>
  stoptimesWithoutPatterns.map((stoptime) => ({
    line: stoptime.trip.routeShortName,
    headsign: stoptime.headsign,
    remainingTime: getRemainingTime(
      moment.unix(stoptime.serviceDay + stoptime.realtimeDeparture)
    ),
    time: moment.unix(stoptime.serviceDay + stoptime.realtimeDeparture),
    realtime: stoptime.realtime,
    cancelled: stoptime.realtimeState === "CANCELED",
    pickup:
      stoptime.pickupType === "SCHEDULED" ||
      stoptime.pickupType === "" ||
      stoptime.pickupType === undefined,
    stop: stoptime.stop,
    trip: {
      gtfsId: stoptime.trip.gtfsId,
      tripHeadsign: stoptime.trip.tripHeadsign,
      route: {
        gtfsId: stoptime.trip.route.gtfsId,
        type: stoptime.trip.route.type,
        color: stoptime.trip.route.color,
        textColor: stoptime.trip.route.textColor,
        longName: stoptime.trip.route.longName
      },
      stoptimes: stoptime.trip.stoptimes
        .filter((item) => item.scheduledDeparture > stoptime.scheduledDeparture)
        .map((item) => ({
          ...item,
          time: moment.unix(stoptime.serviceDay + item.realtimeDeparture)
        }))
    }
  }));

const getRemainingTime = (time) =>
  Math.round(moment.duration(time.diff(moment())).asMinutes());

module.exports = NodeHelper.create({
  initData: {
    core: undefined,
    instances: []
  },
  urls: {
    HSL: "https://api.digitransit.fi/routing/v1/routers/hsl/index/graphql",
    VR: "https://api.digitransit.fi/routing/v1/routers/finland/index/graphql",
    default:
      "https://api.digitransit.fi/routing/v1/routers/waltti/index/graphql"
  },

  socketNotificationReceived: function (notification, payload) {
    const [instanceId, type] = notification.split("::");

    if (type === "CORE_INIT") {
      Log.log(instanceId, type);
      this.initData = { ...this.initData, ...payload, core: instanceId };
      return;
    }

    const instance = this.initData?.instances.find(
      (item) => item.id === instanceId
    );

    if (instance?.debug) {
      Log.log(instanceId, type, payload);
    }

    if (type === "INIT") {
      if (instance === undefined) {
        this.initData.instances.push({
          id: instanceId,
          debug: payload.debug,
          feed: payload.feed
        });
      } else {
        const index = this.initData?.instances.findIndex(
          (item) => item.id === instanceId
        );
        this.initData.instances[index] = {
          id: instanceId,
          debug: payload.debug,
          feed: payload.feed
        };
      }
      return this.sendInstanceSocketNotification(
        instanceId,
        "READY",
        undefined
      );
    }

    if (type === "WAKE_UP") {
      if (this.initData?.instances?.length) {
        return this.initData.instances.forEach((item) =>
          this.sendInstanceSocketNotification(item.id, "AWAKE", undefined)
        );
      }
      return this.sendInstanceSocketNotification(
        instanceId,
        "AWAKE",
        undefined
      );
    }

    const url =
      instance?.feed === "HSL"
        ? this.urls.HSL
        : instance?.feed === "digitraffic"
          ? this.urls.VR
          : this.urls.default;

    if (type === "FETCH_BATCH") {
      return payload.forEach((item) => {
        if (item.notification === "SEARCH_STOP") {
          return this.fetchSearchStop(
            instance ?? instanceId,
            url,
            item.payload
          );
        }
        if (item.notification === "FETCH_STOP_STOPTIMES") {
          return this.fetchStopStoptimes(
            instance ?? instanceId,
            url,
            item.payload
          );
        }
        if (item.notification === "FETCH_BIKE_STATION") {
          return this.fetchBikeStation(
            instance ?? instanceId,
            url,
            item.payload
          );
        }
        Log.warn(
          `Unhandled socket notification ${item.notification}`,
          item.payload
        );
      });
    }

    if (type === "FETCH_BIKE_STATION") {
      return this.fetchBikeStation(instance ?? instanceId, url, payload);
    }

    if (type === "FETCH_STOP_STOPTIMES") {
      return this.fetchStopStoptimes(instance ?? instanceId, url, payload);
    }

    if (type === "SEARCH_STOP") {
      return this.fetchSearchStop(instance ?? instanceId, url, payload);
    }

    if (type === "NOTIFICATION") {
      return this.sendInstanceSocketNotification(instance ?? instanceId, type, {
        id: uuidv4(),
        ...payload
      });
    }

    Log.warn(`Unhandled socket notification ${notification}`, payload);
  },

  sendInstanceSocketNotification: function (instance, notification, payload) {
    this.sendSocketNotification(
      `${instance?.id ?? instance}::${notification}`,
      payload
    );
  },

  fetchStopStoptimes: function (instance, url, payload) {
    this.getStopSchedule(
      url,
      instance.feed,
      payload,
      (data) => this.resolve(instance, "RESOLVE_STOP_STOPTIMES", data),
      (error) => this.reject(error, instance, "REJECT_STOP_STOPTIMES", payload)
    );
  },

  fetchBikeStation: function (instance, url, payload) {
    this.getBikeStation(
      url,
      payload,
      (data) =>
        this.resolve(instance?.id ?? instance, "RESOLVE_BIKE_STATION", data),
      (error) =>
        this.reject(
          error,
          instance?.id ?? instance,
          "REJECT_BIKE_STATION",
          payload
        )
    );
  },

  fetchSearchStop: function (instance, url, payload) {
    this.getStopSearch(
      url,
      instance.feed,
      payload,
      (data) =>
        this.resolve(instance?.id ?? instance, "RESOLVE_SEARCH_STOP", data),
      (error) =>
        this.reject(
          error,
          instance?.id ?? instance,
          "REJECT_SEARCH_STOP",
          payload
        )
    );
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

  getStopSearch: function (url, feed, stop, resolve, reject) {
    try {
      fetch(url, {
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
                stops: json.data.stops.filter((item) =>
                  item.gtfsId.startsWith(`${feed}:`)
                )
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

  getStopSchedule: function (url, feed, stop, resolve, reject) {
    try {
      fetch(url, {
        method: "POST",
        body: getStopTimesQuery(
          feed ?? "HSL",
          stop.type ?? "stop",
          stop.id,
          feed === "digitraffic"
            ? stop.stopTimesCount * 100
            : stop.stopTimesCount,
          moment()
            .add(stop.minutesFrom ?? 0, "minutes")
            .unix()
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
              stopsLength: data.stops.length,
              stopTimes: processStopTimeData(
                data.stoptimesWithoutPatterns
                  .filter((stoptime) =>
                    feed === "digitraffic"
                      ? stoptime.trip?.route?.type !== 109
                      : true
                  )
                  .slice(
                    0,
                    feed === "digitraffic" ? stop.stopTimesCount : undefined
                  )
              ),
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
                  startTime: moment.unix(alert.effectiveStartDate),
                  endTime: moment.unix(alert.effectiveEndDate),
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
  },

  getBikeStation: function (url, stop, resolve, reject) {
    try {
      fetch(url, {
        method: "POST",
        body: getHSLBikeStationQuery(stop.id),
        headers: this.getHeaders()
      })
        .then(NodeHelper.checkFetchStatus)
        .then((response) => response.json())
        .then((json) => {
          if (!json.data) {
            return reject("No data");
          }
          const data = json.data.bikeRentalStation;
          if (!data) {
            return reject(`No bike station data for ${stop.id}`);
          }
          return resolve({
            ...stop,
            data: {
              name: data.name,
              responseType: "BIKE_STATION",
              bikeRentalStation: data
            }
          });
        })
        .catch((error) => reject(error));
    } catch (error) {
      return reject(error);
    }
  }
});
