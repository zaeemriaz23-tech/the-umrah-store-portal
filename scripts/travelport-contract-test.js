'use strict';
// Offline contract tests for the Travelport request builders; no API credentials or network calls.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tus-travelport-contract-'));
for (const k of ['TRAVELPORT_USERNAME','TRAVELPORT_PASSWORD','TRAVELPORT_CLIENT_ID','TRAVELPORT_CLIENT_SECRET','TRAVELPORT_ACCESS_GROUP','TRAVELPORT_PCC_CORE','TRAVELPORT_CONTENT_SOURCES']) delete process.env[k];
const TP = require('../lib/travelport');

const flight = TP.searchFlightsRequest({ from:'LHE', to:'JED', date:'2030-01-10', ret:'2030-01-25', adults:2, children:1, infants:1, ages:'9', cls:'1' });
const air = flight.CatalogProductOfferingsQueryRequest.CatalogProductOfferingsRequest;
assert.strictEqual(air['@type'], 'CatalogProductOfferingsRequestAir');
assert.strictEqual(air.contentSourceList.length, 1);
assert.strictEqual(air.contentSourceList[0], 'GDS');
assert.strictEqual(air.SearchCriteriaFlight.length, 2);
assert.strictEqual(air.SearchCriteriaFlight[0].From.value, 'LHE');
assert.strictEqual(air.SearchCriteriaFlight[1].To.value, 'LHE');
assert.deepStrictEqual(air.PassengerCriteria.map(x => x.passengerTypeCode), ['ADT','CNN','INF']);
assert.strictEqual(air.PassengerCriteria[1].age, 9);
assert.strictEqual(air.SearchModifiersAir.CabinPreference[0].cabins[0], 'Economy');

const hotel = TP.hotelSearchRequest({ city:'Makkah', hotelName:'Clock Tower', cin:'2030-02-01', cout:'2030-02-05', adults:2, children:2, ages:'5,9', rooms:1 });
assert.deepStrictEqual(hotel.propertyFilter.location, { city:'Makkah', countryCode:'SA' });
assert.strictEqual(hotel.propertyFilter.hotelNameContains, 'Clock Tower');
assert.deepStrictEqual(hotel.stayDetails.guests, { numberOfAdults:2, numberOfChildren:2, childAges:[5,9] });
assert.strictEqual(hotel.stayDetails.rooms, 1);
assert.strictEqual(hotel.requestedCurrency, 'SAR');

const traveler = TP.makeTraveler({ firstName:'FAHEEM', lastName:'RAZA', birthDate:'1990-01-01', gender:'Male', passport:'AB1234567', passportExpiry:'2035-01-01', passportIssueCountry:'PK' });
assert.strictEqual(traveler['@type'], 'Traveler');
assert.strictEqual(traveler.TravelDocument[0].docType, 'Passport');
assert.throws(() => TP.makeTraveler({ firstName:'THISNAMEISTOOLONGFOR', lastName:'TRAVELPORTLIMIT', birthDate:'1990-01-01', gender:'Male', passport:'AB1234567', passportExpiry:'2035-01-01' }), /22 characters/);
assert.throws(() => TP.searchFlightsRequest({ from:'LHE', to:'JED', date:'2030-01-10', legs:[1,2,3] }), /one-way and return/);
assert.strictEqual(TP.config().configured, false);
console.log('Travelport request contract tests passed (flight search, hotel SearchComplete, travellers, credential guard).');
