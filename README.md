# Publika

HSL (Helsinki region, Finland) public transport schedule times module for MirrorMirror project

![Module](docs/yrsqqZhy.png)

## What it does

The `publika` module shows public transport timetables from HSL (Helsinki region, Finland)

## Functionalities

- Can display several stops, stations and/or clusters based on configuration
- Displays stop code, platform/track and ticket zones
- Supports english, finnish and swedish
- Displays times in realtime when available
  - If not, it displays the scheduled departure using the `~` symbol, like HSL does. 
- Displays cancelled trips
- Amount of stops to display can be configured for all stops or individually
- Displays alerts for services and stops/stations
- Can display one stop or the whole station or cluster
  - For example, one train station has at least two stops, aka tracks. Some bus stations has several platforms
- Can set a delay start to a stop
  - For example in the case the stop is a bit far, so services that start before the delay are not shown
- Stop, station and cluster IDs can be searched directly with the module

## Dependencies

- DigiTransit (**required**, free): https://digitransit.fi/en/developers/
  - Used for fetching timetables and searching for stops and stations
  - Note: For now no API key is needed, but this would change in the future (april 2023)

## Other screenshots
- Single stop view:

![Bus view](docs/JKsyQpwj.png)

- Search stop and station IDs from the module:

![Search stop and station IDs from the module](docs/EaMxuCKL.png)

- Supports english, finnish and swedish:

![Supports english, finnish and swedish](docs/guxNoZSP.png)

## Getting started

1) Clone this repository under `MagicMirror/modules` folder
2) Add the module to the modules array in the `MagicMirror/config/config.js` file:

```js
{
  module: "publika",
  position: "top_right",
  header: "HSL schedule",
  config: {
    stops: [1000105],
    stopTimesCount: 5,
  }
}
```

### Configuration options

`config`:

| Option | Required | Type | Default | Description | Example |
| --- | --- | --- | --- | --- | --- |
| hslApiKey | no | `string` | `undefined` | API key for use of HSL DigiTransit API. It will be required starting from april 3rd, 2023 | `"abc123def456ghi789"` |
| stopTimesCount | no | `number` | `5` | Amount of stops for all stops | `3` |
| fullHeadsign | no | `boolean` | `false` | Show complete headsign for all stops. For example: Töölön halli via Kallio | `true` |
| stops | yes | `array<string \|  number \| StopObject>` | `undefined` | List of stops to display in the module | `[1020453]` |

`stops` can be an array of string, number, `StopObject` or a mix of them:
```js
{
  config: {
    stops: [
      "H0082",
      { id: 1000105, type: "station" },
      1020453,
    ]
  }
}
```

- A string represents a stop code to search for, or the stop name to search for
- A number represents the stop ID, which is needed for actually displaying stop data

`StopObject`:

| Option | Required | Type | Default | Description | Example |
| --- | --- | --- | --- | --- | --- |
| id | yes | `number` | `undefined` | ID of the stop, station or cluster | `1020453` |
| name | no | `string` | `undefined` | Name to display on the stop title, next to the stop name | `"To city center"` |
| type | no | `string` | `stop` | Only needed when using station or cluster, otherwise assumed to be a stop | `"station"` |
| minutesFrom | no | `number` | `undefined` | Only fetch services starting this amount of minutes from now | `3` |
| stopTimesCount | no | `number` | Same as parent `stopTimesCount` if set, otherwise `5` | Amount of stops for this particular stop | `7` |
| fullHeadsign | no | `boolean` | Same as parent `fullHeadsign` if set, otherwise `false` | Show complete headsign for this particular stop. For example: Lentoasema via Myyrmäki | `true` |
| disabled | no | `boolean` | `false` | If set to `true`, the module will not show nor fetch this stop | `false` |

## Glossary

| Term | Explanation |
| --- | --- |
| Station | A location, which contains stops. For example, a train station is a station and its platforms are stops. |
| Stop | A public transport stop, from which passengers can board vehicles. |
| Cluster | A list of stops, grouped by name and proximity. |
