module.exports = (count, startTime) => `
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
    }`;
