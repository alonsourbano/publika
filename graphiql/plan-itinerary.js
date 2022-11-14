module.exports = (from, to, stopTimesCount) => `{
  plan(numItineraries: ${stopTimesCount}, from: {lat: ${from.lat}, lon: ${from.lon}}, to: {lat: ${to.lat}, lon: ${to.lon}}, transportModes: [{mode: WALK}, {mode: RAIL}]) {
    itineraries {
      walkDistance
      duration
      startTime
      endTime
      waitingTime
      walkTime
      fares {
        type
        currency
        cents
      }
      legs {
        mode
        startTime
        endTime
        realTime
        distance
        duration
        trip {
          tripShortName
          tripHeadsign
          routeShortName
          bikesAllowed
          route {
            type
          }
        }
        from {
          ...place
        }
        to {
          ...place
        }
        agency {
          gtfsId
          name
        }
        legGeometry @include(if: false) {
          length
          points
        }
      }
    }
  }
}

fragment place on Place {
  lat
  lon
  name
  stop {
    gtfsId
    code
    desc
    name
    platformCode
  }
}`;
