import { describe, test, expect } from "bun:test";
import { buildXbrlSegmentMap } from "../src/lib/xbrl-parser.ts";

// Fixture based on real Amazon _htm.xml structure (accession 0001018724-24-000161).
// Context elements use bare tags (no xbrli: prefix); xbrldi:explicitMember keeps its prefix.
const AMAZON_XML = `<?xml version="1.0" encoding="UTF-8"?>
<xbrl xmlns:us-gaap="http://fasb.org/us-gaap/2024"
      xmlns:amzn="http://www.amazon.com/20240930"
      xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
  <context id="c-200">
    <entity>
      <identifier scheme="http://www.sec.gov/CIK">0001018724</identifier>
      <segment>
        <xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">amzn:NorthAmericaSegmentMember</xbrldi:explicitMember>
      </segment>
    </entity>
    <period>
      <startDate>2024-07-01</startDate>
      <endDate>2024-09-30</endDate>
    </period>
  </context>
  <context id="c-201">
    <entity>
      <identifier scheme="http://www.sec.gov/CIK">0001018724</identifier>
      <segment>
        <xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">amzn:InternationalSegmentMember</xbrldi:explicitMember>
      </segment>
    </entity>
    <period>
      <startDate>2024-07-01</startDate>
      <endDate>2024-09-30</endDate>
    </period>
  </context>
  <context id="c-202">
    <entity>
      <identifier scheme="http://www.sec.gov/CIK">0001018724</identifier>
      <segment>
        <xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">amzn:AmazonWebServicesSegmentMember</xbrldi:explicitMember>
      </segment>
    </entity>
    <period>
      <startDate>2024-07-01</startDate>
      <endDate>2024-09-30</endDate>
    </period>
  </context>
  <!-- Consolidated context — no segment dimension -->
  <context id="c-100">
    <entity>
      <identifier scheme="http://www.sec.gov/CIK">0001018724</identifier>
    </entity>
    <period>
      <startDate>2024-07-01</startDate>
      <endDate>2024-09-30</endDate>
    </period>
  </context>
  <us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="c-200" decimals="-6" id="f-1040" unitRef="usd">95537000000</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>
  <us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="c-201" decimals="-6" id="f-1041" unitRef="usd">35887000000</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>
  <us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="c-202" decimals="-6" id="f-1042" unitRef="usd">27452000000</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>
  <us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax contextRef="c-100" decimals="-6" id="f-1043" unitRef="usd">158876000000</us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax>
</xbrl>`;

// Same data but with xbrli: namespace prefixes on structural elements (older EDGAR style)
const PREFIXED_XML = AMAZON_XML
  .replace(/<context /g, "<xbrli:context ")
  .replace(/<\/context>/g, "</xbrli:context>")
  .replace(/<period>/g, "<xbrli:period>")
  .replace(/<\/period>/g, "</xbrli:period>")
  .replace(/<startDate>/g, "<xbrli:startDate>")
  .replace(/<\/startDate>/g, "</xbrli:startDate>")
  .replace(/<endDate>/g, "<xbrli:endDate>")
  .replace(/<\/endDate>/g, "</xbrli:endDate>")
  .replace(/<entity>/g, "<xbrli:entity>")
  .replace(/<\/entity>/g, "</xbrli:entity>")
  .replace(/<segment>/g, "<xbrli:segment>")
  .replace(/<\/segment>/g, "</xbrli:segment>")
  .replace(/<identifier /g, "<xbrli:identifier ")
  .replace(/<\/identifier>/g, "</xbrli:identifier>");

const AXIS = "StatementBusinessSegmentsAxis";
const CONCEPT = "RevenueFromContractWithCustomerExcludingAssessedTax";

describe("buildXbrlSegmentMap", () => {
  test("returns one entry per segment context", () => {
    const map = buildXbrlSegmentMap(AMAZON_XML, AXIS, CONCEPT);
    expect(map.size).toBe(3);
  });

  test("excludes consolidated fact (context without the dimension)", () => {
    const map = buildXbrlSegmentMap(AMAZON_XML, AXIS, CONCEPT);
    // The consolidated value 158876000000 should not appear
    const keys = [...map.keys()];
    expect(keys.some((k) => k.startsWith("158876000000::"))).toBe(false);
  });

  test("key format is val::startDate::endDate", () => {
    const map = buildXbrlSegmentMap(AMAZON_XML, AXIS, CONCEPT);
    expect(map.has("95537000000::2024-07-01::2024-09-30")).toBe(true);
    expect(map.has("35887000000::2024-07-01::2024-09-30")).toBe(true);
    expect(map.has("27452000000::2024-07-01::2024-09-30")).toBe(true);
  });

  test("converts NorthAmericaSegmentMember to 'North America'", () => {
    const map = buildXbrlSegmentMap(AMAZON_XML, AXIS, CONCEPT);
    expect(map.get("95537000000::2024-07-01::2024-09-30")).toBe("North America");
  });

  test("converts InternationalSegmentMember to 'International'", () => {
    const map = buildXbrlSegmentMap(AMAZON_XML, AXIS, CONCEPT);
    expect(map.get("35887000000::2024-07-01::2024-09-30")).toBe("International");
  });

  test("converts AmazonWebServicesSegmentMember to 'Amazon Web Services'", () => {
    const map = buildXbrlSegmentMap(AMAZON_XML, AXIS, CONCEPT);
    expect(map.get("27452000000::2024-07-01::2024-09-30")).toBe("Amazon Web Services");
  });

  test("works with xbrli: namespace-prefixed context elements", () => {
    const map = buildXbrlSegmentMap(PREFIXED_XML, AXIS, CONCEPT);
    expect(map.size).toBe(3);
    expect(map.get("95537000000::2024-07-01::2024-09-30")).toBe("North America");
  });

  test("returns empty map when no segment contexts exist", () => {
    const xml = AMAZON_XML.replace(/StatementBusinessSegmentsAxis/g, "ProductOrServiceAxis");
    const map = buildXbrlSegmentMap(xml, AXIS, CONCEPT);
    expect(map.size).toBe(0);
  });

  test("axis is matched as a substring (handles namespace-prefixed dimension attributes)", () => {
    // dimension="us-gaap:StatementBusinessSegmentsAxis" — passing just the local name should match
    const map = buildXbrlSegmentMap(AMAZON_XML, "BusinessSegmentsAxis", CONCEPT);
    expect(map.size).toBe(3);
  });

  test("instant period uses empty string for startDate in key", () => {
    const xml = `<?xml version="1.0"?>
<xbrl xmlns:us-gaap="http://fasb.org/us-gaap/2024"
      xmlns:co="http://example.com/co"
      xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
  <context id="ctx-1">
    <entity><identifier scheme="http://www.sec.gov/CIK">0001234567</identifier>
      <segment>
        <xbrldi:explicitMember dimension="us-gaap:StatementGeographicalAxis">co:USMember</xbrldi:explicitMember>
      </segment>
    </entity>
    <period><instant>2024-09-30</instant></period>
  </context>
  <us-gaap:Assets contextRef="ctx-1" decimals="-6" unitRef="usd">50000000000</us-gaap:Assets>
</xbrl>`;
    const map = buildXbrlSegmentMap(xml, "StatementGeographicalAxis", "Assets");
    expect(map.has("50000000000::::2024-09-30")).toBe(true);
    expect(map.get("50000000000::::2024-09-30")).toBe("US");
  });

  test("plain 'Member' suffix is stripped (non-segment companies)", () => {
    const xml = `<?xml version="1.0"?>
<xbrl xmlns:us-gaap="http://fasb.org/us-gaap/2024"
      xmlns:co="http://example.com/co"
      xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
  <context id="ctx-aws">
    <entity><identifier scheme="http://www.sec.gov/CIK">0001234567</identifier>
      <segment>
        <xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">co:AWSMember</xbrldi:explicitMember>
      </segment>
    </entity>
    <period><startDate>2024-01-01</startDate><endDate>2024-03-31</endDate></period>
  </context>
  <us-gaap:Revenues contextRef="ctx-aws" decimals="-6" unitRef="usd">25000000</us-gaap:Revenues>
</xbrl>`;
    const map = buildXbrlSegmentMap(xml, "StatementBusinessSegmentsAxis", "Revenues");
    expect(map.get("25000000::2024-01-01::2024-03-31")).toBe("AWS");
  });
});
