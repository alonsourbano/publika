const alerts = require("./alerts");

module.exports = (feed, type, stop, count, startTime) => `{
    ${type}(id: "${feed}:${stop}") {
      gtfsId
      name
      code
      desc
      zoneId
      vehicleMode
      platformCode
      locationType
      stoptimesWithoutPatterns(numberOfDepartures: ${count}, startTime: ${startTime}, omitNonPickups: false, omitCanceled: false) {
        realtimeDeparture
        scheduledDeparture
        realtime
        realtimeState
        serviceDay
        headsign
        pickupType
        stop {
          platformCode
          vehicleMode
        }
        trip {
          gtfsId
          tripHeadsign
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
            color
            textColor
            longName
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
