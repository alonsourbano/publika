module.exports = (id) => `{
  bikeRentalStation(id: "${id}") {
    stationId
    name
    bikesAvailable
    spacesAvailable
    capacity
    state
    realtime
    allowOverloading
    isFloatingBike
    isCarStation
    networks
    lat
    lon
    allowDropoff
  }
}`;
