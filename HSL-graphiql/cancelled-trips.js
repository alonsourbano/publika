module.exports = (routes) => `{
  cancelledTripTimes(routes: [${routes}]) {
    realtimeDeparture
    scheduledDeparture
    realtime
    realtimeState
    serviceDay
    headsign
    stop {
      gtfsId
      name
    }
    trip {
      stoptimes {
        stop {
          gtfsId
          name
        }
        headsign
        scheduledDeparture
        realtimeDeparture
      }
      route {
        gtfsId
      }
      routeShortName
    }
  }
}`;
