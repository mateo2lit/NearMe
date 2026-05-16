import { getEventImage } from "../images";

describe("getEventImage", () => {
  it("keeps source-provided images first", () => {
    const sourceImage = "https://example.com/event-photo.jpg";

    expect(
      getEventImage(
        sourceImage,
        "nightlife",
        undefined,
        "Glow Bowl Night",
        "Couples and friends welcome",
        ["date-night"],
        "Bowlero",
      ),
    ).toBe(sourceImage);
  });

  it("lets concrete activity context beat broad lifestyle tags", () => {
    const bowlingFallback = getEventImage(null, "sports", "bowling");

    expect(
      getEventImage(
        null,
        "nightlife",
        undefined,
        "Friday Night Open Play",
        "Couples and friends welcome",
        ["date-night"],
        "Bowlero Boca Raton",
      ),
    ).toBe(bowlingFallback);
  });
});
