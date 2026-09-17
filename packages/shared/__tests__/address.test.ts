import { composeStructuredAddress, parseAddressSearchSuggestion } from '../src/address'

describe('structured address search', () => {
  it('maps a provider result into the fields used by fulfillment eligibility', () => {
    expect(parseAddressSearchSuggestion({
      place_id: 42,
      display_name: '14 Kofi Atta Annan Street, Accra, Greater Accra, Ghana',
      address: {
        house_number: '14',
        road: 'Kofi Atta Annan Street',
        city: 'Accra',
        state: 'Greater Accra',
        country: 'Ghana',
        country_code: 'gh',
      },
    })).toMatchObject({
      line1: '14 Kofi Atta Annan Street',
      city: 'Accra',
      stateRegion: 'Greater Accra',
      country: 'Ghana',
      countryCode: 'GH',
    })
  })

  it('keeps manual structured addresses readable', () => {
    expect(composeStructuredAddress({
      line1: '12 Marina Road',
      line2: '',
      city: 'Lagos',
      stateRegion: 'Lagos',
      postcode: '101241',
      country: 'Nigeria',
    })).toBe('12 Marina Road\nLagos, Lagos\n101241\nNigeria')
  })

  it('does not repeat the house number when the provider splits it into its own fragment', () => {
    const parsed = parseAddressSearchSuggestion({
      place_id: 77,
      display_name: '215, Elm Street, Camberwell, London, Greater London, SE5 8AB, United Kingdom',
      address: {
        house_number: '215',
        road: 'Elm Street',
        suburb: 'Camberwell',
        city: 'London',
        state: 'Greater London',
        postcode: 'SE5 8AB',
        country: 'United Kingdom',
        country_code: 'gb',
      },
    })
    expect(parsed.line1).toBe('215 Elm Street')
    expect(parsed.displayValue).toBe(
      '215 Elm Street, Camberwell, London, Greater London, SE5 8AB, United Kingdom',
    )
    expect(parsed.displayValue).not.toContain('215, 215')
  })

  it('treats suffixed and ranged house numbers as numbers, not place names', () => {
    expect(parseAddressSearchSuggestion({
      display_name: '12-14, Marina Road, Lagos, Lagos, Nigeria',
      address: {
        house_number: '12-14',
        road: 'Marina Road',
        city: 'Lagos',
        state: 'Lagos',
        country: 'Nigeria',
        country_code: 'ng',
      },
    }).line1).toBe('12-14 Marina Road')

    expect(parseAddressSearchSuggestion({
      display_name: '215A, Elm Street, London, United Kingdom',
      address: {
        house_number: '215A',
        road: 'Elm Street',
        city: 'London',
        country: 'United Kingdom',
        country_code: 'gb',
      },
    }).line1).toBe('215A Elm Street')
  })

  it('keeps a searched venue visible when the provider also returns a road', () => {
    expect(parseAddressSearchSuggestion({
      display_name: 'Accra Mall, Spintex Road, Accra, Greater Accra, Ghana',
      address: {
        shop: 'Accra Mall',
        road: 'Spintex Road',
        city: 'Accra',
        state: 'Greater Accra',
        postcode: 'GD-110-6313',
        country: 'Ghana',
        country_code: 'gh',
      },
    })).toMatchObject({
      line1: 'Accra Mall',
      line2: 'Spintex Road',
      city: 'Accra',
      stateRegion: 'Greater Accra',
      countryCode: 'GH',
      displayValue: 'Accra Mall, Spintex Road, Accra, Greater Accra, GD-110-6313, Ghana',
    })
  })
})
