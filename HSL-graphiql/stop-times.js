const alerts = require("./alerts");

module.exports = (type, stop, count, startTime) => {
  return `{
    ${type}(id: "HSL:${stop}") {
      gtfsId
      name
      code
      desc
      zoneId
      vehicleMode
      platformCode
      locationType
      routes {
        ${alerts}
      }
      stops {
        routes {
          ${alerts}
        }
        ${alerts}
      }
      stoptimesWithoutPatterns(numberOfDepartures: ${count}, startTime: ${startTime}, omitNonPickups: true, omitCanceled: false) {
        realtimeDeparture
        scheduledDeparture
        realtime
        realtimeState
        serviceDay
        headsign
        trip {
          gtfsId
          routeShortName
          route {
            gtfsId
            ${alerts}
          }
          ${alerts}
        }
      }
      ${alerts}
    }
  }`;
};
