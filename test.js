#!/usr/bin/env node

import http from 'node:http';
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
        // Valid but non-existing postcodes
        assert.equal('ZZ9Z9ZZ', nmp.format_postcode('zz 9z9z  z'));
        // Invalid postcodes should raise error
        assert.throws(() => nmp.format_postcode('ABCD1234'), new Error(nmp.E_FORMAT));
        assert.throws(() => nmp.format_postcode('ab12_345'), new Error(nmp.E_FORMAT));
        assert.throws(() => nmp.format_postcode('A'), new Error(nmp.E_FORMAT));
    });
  
    it('should convert postcodes to coordinates correctly', async () => {
        const nmp = await NearMyPostcode(databuf, true);
        const cases = {
            sw1a: {cpc: "SW1A",        coords:[-0.13218647252613103,51.5044968742504]},
            cb1: {cpc: "CB1 ",         coords:[ 0.14143769251545102,52.19525652785534]},
            b1: {cpc: "B1  ",          coords:[-1.9093050120546273 ,52.47981422664225]},
            sw1a2aa: {cpc: "SW1A2AA",  coords:[-0.12764373597314282,51.50349842618448]},
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
        // Also check a non-existing but valid code for the right error:
        assert.throws(() => nmp.lookup_postcode('zz9z9zz'), new Error(nmp.E_NOTFOUND));
    });
  
    it('can calculate the distance between coordinates', async () => {
        const nmp = await NearMyPostcode(databuf, true);
        const dist = nmp.distance_between([ 0.14143769251545102,52.19525652785534],[ 0.12311532175173667,52.20324411238269]);
        const expected = 1.53; // Killometers
        assert((expected * 0.95) <= dist && dist <= (expected * 1.05), `Distance between points is not correct within 5%: ${dist} is too far from expected distance ${expected}`);
    });
  
    it('can sort a set of points by distance to another point', async () => {
        const nmp = await NearMyPostcode(databuf, true);
        const sorted = nmp.sort_by_distance(
            [
                {name: 'A', postcode: 'AL1'},
                {name: 'E', postcode: 'BB1'},
                {name: 'C', postcode: 'LE1'},
                {name: 'D', postcode: 'S1'},
                {name: 'H', postcode: 'IV1'},
                {name: 'G', postcode: 'G1'},
                {name: 'B', postcode: 'CB1'},
                {name: 'F', postcode: 'DL1'},
            ],
            nmp.lookup_postcode('sw1a')[1],
            a => nmp.lookup_postcode(a.postcode)[1]
        );
        var prev = ' ';
        for (const s of sorted){
            assert(s.item.name.charCodeAt(0) > prev.charCodeAt(0), 'Not sorted in distance order');
            prev = s.item.name;
        }

        assert.throws(() => nmp.sort_by_distance([[0.0,0.0]],0,a=>a))
    });

    it('should be able to load files created for version 1 of the algorithm', async () => {
        const v1data = await fs.openAsBlob('testdata/version=1/A0AA0AA=>(0,0).pack');
        const v1databuf = await v1data.arrayBuffer();
        const nmp = await NearMyPostcode(v1databuf);
        assert.deepEqual('A0AA0AA', nmp.format_postcode('a0aa0aa'));
        assert.deepEqual(['A0AA0AA',[0.0,0.0]], nmp.lookup_postcode('a0aa0aa'));

        // Version 1 files cannot be used to lookup outward-only codes
        await assert.throws(() => nmp.lookup_postcode('A1'), new Error(nmp.E_DATA_VERSION));
    });

    it('should not load files without the right header ID', async () => {
        const brokendata= await fs.openAsBlob('testdata/invalid.pack');
        const brokenbuf = await brokendata.arrayBuffer();
        assert.rejects(async () => await NearMyPostcode(brokenbuf));
    });

    it('should refuse to load files that are too new', async () => {
        const v99data = await fs.openAsBlob('testdata/version=999999/A0AA0AA=>(0,0).pack');
        const v99databuf = await v99data.arrayBuffer();
        assert.rejects(async () => NearMyPostcode(v99databuf));
    });

    it('can load from a URL', async () => {
        assert.rejects(async () => NearMyPostcode('http://localhost:9876/invalid_url'));
        assert.rejects(async () => NearMyPostcode('invalid_url_for_different_reasons'));
        const v1data = await fs.openAsBlob('testdata/version=1/A0AA0AA=>(0,0).pack');
        const v1databuf = await v1data.arrayBuffer();
        const v1bytes= await v1data.bytes();

        const server = http.createServer((req, res) => {
            if (req.url == '/get200'){
                res.writeHead(200, { 'Content-Type': 'application/octet-stream'});
                res.end(v1bytes);
            }
            if (req.url == '/get400'){
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Bad client\n');
            }
        });

        server.listen(9876, 'localhost', () => {
            assert.rejects(async () => NearMyPostcode('http://localhost:9876/get400'));
            NearMyPostcode('http://localhost:9876/get200', true).then(nmp=>{
                server.close();
                assert.equal('A0AA0AA', nmp.format_postcode('A0AA0AA'));
            }).catch(err=>{
                server.close();
                console.error(err);
                assert(false);
            });
        });
    });
});

