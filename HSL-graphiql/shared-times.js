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
      gtfsId
    }
    parentStation {
      gtfsId
    }
    cluster {
      gtfsId
    }
    stops {
      gtfsId
      parentStation {
        gtfsId
      }
      cluster {
        gtfsId
      }
      routes {
        gtfsId
      }
    }
    stoptimesWithoutPatterns(numberOfDepartures: ${count}, startTime: ${startTime}, omitNonPickups: true, omitCanceled: true) {
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
    }`;
