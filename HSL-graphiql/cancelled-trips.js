module.exports = (routes, minDate, minDepartureTime) => {
  return `{
  cancelledTripTimes(routes: [${routes}], minDate: "${minDate}", minDepartureTime: ${minDepartureTime}) {
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
}
