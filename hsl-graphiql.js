module.exports = (stop, count, startTime) => `{
  stop(id: "HSL:${stop}") {
    name
    code
    desc
    zoneId
    direction
    timezone
    vehicleType
    vehicleMode
    platformCode
    parentStation {
      gtfsId
      name
    }
    stops {
      gtfsId
      name
      code
    }
    stoptimesWithoutPatterns(numberOfDepartures: ${count}, startTime: ${startTime}, omitNonPickups: true, omitCanceled: true) {
      realtimeArrival
      realtimeDeparture
      realtime
      serviceDay
      headsign
      trip {
        routeShortName
        alerts {
          alertHash
          alertHeaderTextTranslations {
            text
            language
          }
          alertDescriptionTextTranslations {
            text
            language
          }
          effectiveStartDate
          effectiveEndDate
        }
      }
    }
    alerts {
      alertHash
      alertHeaderTextTranslations {
        text
        language
      }
      alertDescriptionTextTranslations {
        text
        language
      }
      effectiveStartDate
      effectiveEndDate
    }
  }
}`;
