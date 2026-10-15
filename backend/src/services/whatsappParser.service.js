const firstSentence = (text) => text.match(/^[\s\S]*?(?:[.!?](?=\s|$)|\r?\n|$)/)?.[0]?.trim() || text.trim();

export const whatsappParserService = {
  parseMessage: (text) => {
    const normalizedText = String(text || '').trim();
    const sentence = firstSentence(normalizedText);
    const titleSegment = sentence.length <= 80 ? sentence : normalizedText.slice(0, 80);
    const title = (titleSegment || normalizedText).slice(0, 80).trim();
    const description = normalizedText.slice(titleSegment.length).trim();
    const content = normalizedText.toLowerCase();

    if (/\b(pcn|ticket|penalty|dartford|fine)\b/i.test(content)) {
      return {
        boardName: 'Penalty Charge Notice',
        groupName: 'Penalty Charge Notice',
        groupTitle: 'Penalty Charge Notice',
        title,
        description
      };
    }
    if (/\b(bridging|loan)\b/i.test(content)) {
      return {
        boardName: 'Urgent Matters',
        groupName: 'Bridging Loan',
        groupTitle: 'Jasmine Work - Bridging Loan',
        title,
        description
      };
    }
    if (/\b(stamp\s+duty|refund)\b/i.test(content)) {
      return {
        boardName: 'Urgent Matters',
        groupName: 'Stamp Duty Refund',
        groupTitle: 'Stamp Duty Refund',
        title,
        description
      };
    }
    return {
      boardName: 'General Tasks',
      groupName: 'Backlog / Unsorted',
      groupTitle: 'General Tasks',
      title,
      description
    };
  },

  findMentionedNames: (text) => [...String(text || '').matchAll(/@([\p{L}][\p{L}'-]*)/gu)]
    .map((match) => match[1].trim())
};
