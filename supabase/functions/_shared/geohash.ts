const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function geohashEncode(lat: number, lng: number, precision = 5): string {
  if (lat < -90 || lat > 90) throw new RangeError("lat out of range");
  if (lng < -180 || lng > 180) throw new RangeError("lng out of range");

  let latLo = -90,  latHi = 90;
  let lngLo = -180, lngHi = 180;
  let bit = 0;
  let ch = 0;
  let isLng = true;
  let out = "";

  while (out.length < precision) {
    if (isLng) {
      const mid = (lngLo + lngHi) / 2;
      if (lng >= mid) { ch = (ch << 1) | 1; lngLo = mid; }
      else            { ch = (ch << 1);     lngHi = mid; }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; latLo = mid; }
      else            { ch = (ch << 1);     latHi = mid; }
    }
    isLng = !isLng;
    if (++bit === 5) {
      out += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return out;
}
