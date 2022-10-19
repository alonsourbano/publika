module.exports = (type, stop, count, startTime) => `{
  ${type}(id: "HSL:${stop}") {
    name
    code
    desc
    zoneId
    vehicleMode
    platformCode
    locationType
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
