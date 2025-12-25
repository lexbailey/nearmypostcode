#!/usr/bin/env node

import { NearMyPostcode } from './nearmypostcode.mjs';
import fs from 'node:fs';
const data = await fs.openAsBlob('postcodes.pack');
const databuf = await data.arrayBuffer();

import assert from 'node:assert/strict';
import { describe, mock, it } from 'node:test';

describe('NearMyPostcode()', () => {
  it('should format postcodes correctly', async () => {
    const nmp = await NearMyPostcode(databuf, true);
    // Outward-only codes
    assert.equal('SW1A', nmp.format_postcode('sw1a'));
    assert.equal('CB1 ', nmp.format_postcode('cb 1'));
    assert.equal('B1  ', nmp.format_postcode(' b 1'));
    // Full postcodes
    assert.equal('SW1A2AA', nmp.format_postcode('sw1a 2aa'));
    assert.equal('CB2 3DS', nmp.format_postcode('cb23ds '));
  });

  it('should convert postcodes to coordinates correctly', async () => {
    const nmp = await NearMyPostcode(databuf, true);
    // Outward-only codes
    const cases = {
        sw1a: {cpc: "SW1A",        coords:[-0.13218647252613103,51.5044968742504]},
        cb1: {cpc: "CB1 ",         coords:[ 0.14143769251545102,52.19525652785534]},
        b1: {cpc: "B1  ",          coords:[-1.9093050120546273 ,52.47981422664225]},
        sw1a2aa: {cpc: "SW1A2AA", coords:[-0.12764373597314282,51.50349842618448]},
        cb23ds: {cpc: "CB2 3DS",   coords:[ 0.12311532175173667,52.20324411238269]},
    };
    for (const c of Object.keys(cases)){
        const [cpc, [lon,lat]] = nmp.lookup_postcode(c);
        assert.equal(cases[c].cpc, cpc);
        const d_lon = lon - cases[c].coords[0];
        const d_lat = lat - cases[c].coords[1];
        assert(d_lon < 0.01, `lon value incorrect for postcode ${cpc}: expected ${cases[c].coords[0]} but got ${lon}`);
        assert(d_lat < 0.01, `lat value incorrect for postcode ${cpc}: expected ${cases[c].coords[1]} but got ${lat}`);
    }
  });
});

