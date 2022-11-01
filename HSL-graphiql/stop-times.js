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
      stoptimesWithoutPatterns(numberOfDepartures: ${count}, startTime: ${startTime}, omitNonPickups: true, omitCanceled: false) {
        realtimeDeparture
        scheduledDeparture
        realtime
        realtimeState
        serviceDay
        headsign
        stop {
          platformCode
          vehicleMode
        }
        trip {
          gtfsId
          routeShortName
          stoptimes {
            scheduledDeparture
            realtimeDeparture
            realtime
            stop {
              gtfsId
              name
            }
          }
          route {
            gtfsId
            type
            ${alerts}
          }
          ${alerts}
        }
      }
      routes {
        ${alerts}
      }
      stops {
        routes {
          ${alerts}
        }
        ${alerts}
      }
      ${alerts}
    }
  }`;
};
