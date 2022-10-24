const alerts = require("./alerts");

module.exports = (count, startTime) => `
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
        routeShortName
        route {
          ${alerts}
        }
        ${alerts}
      }
    }
    ${alerts}`;
