const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);

export const FOLLOWUP_CONTRACT = "georgie.rehash-lifecycle.v1";

function monthText(months = []) {
  const values = [...new Set((months || []).map(value => clean(value, 20)).filter(Boolean))];
  return values.length ? values.join(" and ") : "the remaining requested month";
}

export function followupMessageFor(intent = {}) {
  const firstName = clean(intent.firstName) || "there";
  const business = clean(intent.businessIdentity) || "your business";
  const secureLink = clean(intent.secureLink, 2000);
  const missing = monthText(intent.missingMonths);
  const state = clean(intent.followupState) || "delivered_no_upload";
  const linkLine = secureLink ? `\n\nSecure upload: ${secureLink}` : "";

  if (state === "partial_upload") {
    return {
      version: FOLLOWUP_CONTRACT,
      subject: `One statement left for ${business}`,
      text: `Hi ${firstName},\n\nI received part of the statement package for ${business}. I only need ${missing} to finish the refresh and move it back through review.${linkLine}\n\nIf you run into any issue with the upload, just reply here and I can help.\n\nGeorgie\nSierra Marketing Inc.`
    };
  }

  if (state === "final_checkin") {
    return {
      version: FOLLOWUP_CONTRACT,
      subject: `Should I keep this funding refresh open for ${business}?`,
      text: `Hi ${firstName},\n\nI wanted to make one last check before I close this refresh for now. If you still want Sierra to review current financing options for ${business}, send ${missing} and I can continue the file.${linkLine}\n\nIf the timing is not right, no problem — you can reply whenever you want us to revisit it.\n\nGeorgie\nSierra Marketing Inc.`
    };
  }

  return {
    version: FOLLOWUP_CONTRACT,
    subject: `Quick follow-up for ${business}`,
    text: `Hi ${firstName},\n\nJust following up on the funding refresh for ${business}. I still need ${missing} to complete the updated review.${linkLine}\n\nOnce those are in, I can move the package forward without making you start over.\n\nGeorgie\nSierra Marketing Inc.`
  };
}