module.exports = (feed, type, stop, count, startTime, omitNonPickups, eta) => `{
    ${type}(id: "${feed}:${stop}") {
      gtfsId
      name
      code
      desc
      zoneId
      vehicleMode
      platformCode
      locationType
      stoptimesWithoutPatterns(numberOfDepartures: ${count}, startTime: ${startTime}, omitNonPickups: ${!!omitNonPickups}, omitCanceled: false) {
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
          stoptimes @include(if: ${!!eta}) {
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
            alerts {
              ...fragmentAlerts
            }
          }
          alerts {
            ...fragmentAlerts
          }
        }
      }
      routes {
        alerts {
          ...fragmentAlerts
        }
      }
      stops {
        routes {
          alerts {
            ...fragmentAlerts
          }
        }
        alerts {
          ...fragmentAlerts
        }
      }
      alerts {
        ...fragmentAlerts
      }
    }
  }
  
  fragment fragmentAlerts on Alert {
    alertHash
    id
    alertEffect
    alertCause
    alertSeverityLevel
    alertHeaderText
    alertHeaderTextTranslations {
      text
      language
    }
    alertDescriptionText
    alertDescriptionTextTranslations {
      text
      language
    }
    alertUrl
    alertUrlTranslations {
      text
      language
    }
    effectiveStartDate
    effectiveEndDate
    route {
      gtfsId
      shortName
      longName
    }
    trip {
      gtfsId
      routeShortName
    }
    stop {
      gtfsId
      name
    }
  }`;
