module.exports = (code) => `{
  stops(name: "${code}") {
    gtfsId
    name
    code
    desc
    zoneId
    vehicleMode
    platformCode
    locationType
    stops {
      gtfsId
      name
    }
    parentStation {
      gtfsId
      name
    }
    cluster {
      gtfsId
      name
    }
  }
}`;
