# Chowdeck Relay Local Delivery Setup

Local home deliveries now use Chowdeck Relay when it is configured. Interstate deliveries, export deliveries, Fez lockers, and Fez hub flows stay on Fez.

## Required environment variables

Set these values before enabling Chowdeck:

- `CHOWDECK_RELAY_ENABLED=true`
- `CHOWDECK_RELAY_API_KEY`
- `CHOWDECK_RELAY_MERCHANT_REFERENCE`
- `CHOWDECK_RELAY_PICKUP_NAME`
- `CHOWDECK_RELAY_PICKUP_PHONE`
- `CHOWDECK_RELAY_PICKUP_STREET`
- `CHOWDECK_RELAY_PICKUP_CITY`
- `CHOWDECK_RELAY_PICKUP_STATE`

Optional overrides:

- `CHOWDECK_RELAY_ESTIMATE_PATH`
- `CHOWDECK_RELAY_CREATE_PATH`
- `CHOWDECK_RELAY_TRACK_PATH`
- `CHOWDECK_RELAY_AMOUNT_IN_MINOR_UNIT`
- `CHOWDECK_RELAY_PICKUP_LATITUDE`
- `CHOWDECK_RELAY_PICKUP_LONGITUDE`
- `CHOWDECK_RELAY_LOCAL_ETA`
- `CHOWDECK_RELAY_WEBHOOK_SECRET`
- `CHOWDECK_RELAY_WEBHOOK_SECRET_HEADER`

If pickup coordinates are set, the relay sends both pickup coordinates and pickup address strings to Chowdeck. That improves quote accuracy for local deliveries.

## Local Lagos address resolution

Local Chowdeck quotes can now resolve Lagos delivery addresses before quoting and order creation. The backend uses a search/geocoding service for that step.

Environment variables:

- `LOCAL_ADDRESS_SEARCH_ENABLED=true`
- `LOCAL_ADDRESS_SEARCH_BASE_URL=https://nominatim.openstreetmap.org`
- `LOCAL_ADDRESS_SEARCH_TIMEOUT_MS=6000`
- `LOCAL_ADDRESS_SEARCH_LIMIT=5`
- `LOCAL_ADDRESS_SEARCH_USER_AGENT=SupplementsNG/1.0 (support@supplements.ng)`

Public helper route:

`GET /api/orders/local-address-search?q=<query>`

## Webhook

Point the Chowdeck Relay webhook to:

`POST /api/webhooks/chowdeck`

If you use a webhook secret, send it in the header named by `CHOWDECK_RELAY_WEBHOOK_SECRET_HEADER`.

## Frontend expectations

Local Chowdeck quotes need a fuller address than the old Fez state-only quote flow. The quote request should include:

- `fullName`
- `phone`
- `addressLine1`
- `city`
- `state`

For best accuracy, store and resend:

- `formattedAddress`
- `latitude`
- `longitude`
- `addressProvider`
- `providerPlaceId`

Recommended flow:

1. Search Lagos addresses with `GET /api/orders/local-address-search`.
2. Let the customer choose a resolved address result.
3. Call `POST /api/orders/shipping-quote` for a local home delivery with the selected coordinates and address details.
4. Store the returned `deliveryFeeId`, `shippingEta`, `quote`, and backend shipping total.
5. Send `deliveryFeeId`, `shippingQuote`, the backend-calculated shipping fee, and the resolved shipping address into `POST /api/orders`.

If the public Chowdeck estimate path differs from the default candidates, set `CHOWDECK_RELAY_ESTIMATE_PATH` explicitly.

The documented Chowdeck fee endpoint is:

`POST /merchant/{merchantReference}/delivery/fee`
