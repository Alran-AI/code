/**
 * The names of the upstream product, kept encoded.
 *
 * The gates have to look for these names, and the repository must not contain
 * them. They are therefore stored base64-encoded and decoded here, in the one
 * place that needs them. Nothing else in the repository may spell them out.
 *
 * The list covers the upstream product name, the names of its CLI and runtime,
 * the hosts of the companies behind it, and the reporting endpoints they
 * operated.
 */

const decode = (encoded) => Buffer.from(encoded, 'base64').toString('utf8');

/** The name of the upstream product, and the prefix of the hosts of its company. */
export const upstreamName = decode('bWluaW1heA==');

/** The second spelling of the upstream product name. */
export const upstreamSpelling = decode('bWluaS1tYXg=');

/** The name of the upstream CLI and of its npm package. */
export const upstreamCliName = decode('bWNvZGU=');

/** The name the upstream runtime used for its data directory and its environment. */
export const upstreamRuntimeName = decode('bWF2aXM=');

/** The host of the reporting endpoint of the upstream company. */
export const upstreamReportingHost = decode('aGFpbHVv');

/** The name in the reporting hosts of the upstream company. */
export const upstreamReportingName = decode('eGluZ3ll');

/** The second name in the reporting hosts of the upstream company. */
export const upstreamReportingAltName = decode('dGFsa2llLWFp');

/** The internal host domain of the upstream company. */
export const upstreamInternalHost = decode('eGFtaW5pbQ==');

/** The internal path prefix of the upstream company. */
export const upstreamInternalPath = decode('d2VhdmVy');

/** The company that operated the reporting infrastructure. */
export const upstreamDataCompany = decode('d2VpbGxhYg==');

/** The name of the reporting service of the upstream company. */
export const upstreamReportingService = decode('bWVlcmthdA==');

/** The names and hosts that may not appear outside the legal attribution files. */
export const BRAND_TERMS = Object.freeze([
	upstreamName,
	upstreamSpelling,
	upstreamCliName,
	upstreamRuntimeName,
	upstreamReportingHost,
	upstreamReportingName,
	upstreamReportingAltName,
	upstreamInternalHost,
	upstreamDataCompany,
	upstreamReportingService,
]);

/**
 * The regex sources that catch the internal hosts and paths of the upstream company.
 *
 * They are regex sources, not plain names, so they are encoded the same way.
 */
export const INTERNAL_REFERENCE_SOURCES = Object.freeze([
  decode('W1x3Li1dK1wueGFtaW5pbVwuY29t'),
  decode('d2VhdmVyXC9pZGw='),
]);

/** The strings the license gate checks the legal files for. */
export const upstreamCopyright = decode('Q29weXJpZ2h0IChjKSAyMDI2IE1pbmlNYXggQ29kZQ==');
export const upstreamSourceUrl = decode('aHR0cHM6Ly9naXRodWIuY29tL21pbmltYXgtYWkvbWluaW1heC1jb2Rl');
export const upstreamReference = decode('ZGVyaXZlZCBmcm9tIE1pbmlNYXggQ29kZQ==');
export const upstreamModifications = decode('TW9kaWZpY2F0aW9ucyBtYWRlIHRvIE1pbmlNYXggQ29kZQ==');
export const nestedCopyright = decode('Q29weXJpZ2h0IChjKSAyMDI2IE1pbmlNYXhBSQ==');
