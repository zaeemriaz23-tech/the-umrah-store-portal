'use strict';
/** Search adapter: all live flight and hotel inventory is sourced from Travelport TripServices. */
const TP = require('./travelport');
const { db } = require('./db');
const markup = n => Math.round((+n || 0) * (1 + (db.settings.markupPct || 0) / 100) * 100) / 100;
const flights = (q, user) => TP.flights(q, user);
const flightReturn = (q, user) => TP.flights(q, user);
const multiFlights = () => { throw new Error('Multi-city live booking is not enabled yet. Use one-way or return search.'); };
const multiFlightNext = () => { throw new Error('Multi-city live booking is not available yet. Please use one-way or return search.'); };
const hotels = (q, user) => TP.hotels(q, user);
const hotelDetail = () => { throw new Error('Hotel room selection will be enabled after Travelport Stays booking access is confirmed.'); };
const forUser = (result, user) => TP.forUser(result, user);
module.exports = { flights, flightReturn, multiFlights, multiFlightNext, hotels, hotelDetail, forUser, markup, travelportStatus: TP.status, travelportTest: TP.testConnection, priceFlight: TP.priceFlight, holdFlight: TP.holdFlight };
