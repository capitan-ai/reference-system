const LOCATION_OPTIONS = [
  { id: 'all', label: 'All Locations' },
  { id: 'union', label: 'Union St' },
  { id: 'pacific', label: 'Pacific Ave' }
]

const LOCATION_FILTER_IDS = LOCATION_OPTIONS.filter((loc) => loc.id !== 'all').map((loc) => loc.id)

module.exports = {
  LOCATION_OPTIONS,
  LOCATION_FILTER_IDS
}


