module.exports = `
  alerts {
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
