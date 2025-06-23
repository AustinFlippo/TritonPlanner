import * as cheerio from 'cheerio';
import fs from 'fs';

/**
 * Robust HTML audit parser that works with various HTML structures
 * Extracts sections and attempts to determine status from content and styling
 */
export function parseHtmlAudit(htmlFilePath) {
  try {
    
    // Read HTML file
    const htmlContent = fs.readFileSync(htmlFilePath, 'utf8');
    const $ = cheerio.load(htmlContent);
    
    const sections = [];
    
    
    // Strategy 1: Look for sections with audit color classes (TritonSEA style)
    const auditSelectors = [
      '.text-auditGray',   // fulfilled
      '.text-auditBlue',   // in-progress  
      '.text-auditRed'     // not fulfilled
    ];
    
    auditSelectors.forEach(selector => {
      $(selector).each((index, element) => {
        const section = extractSectionFromElement($, $(element), getStatusFromClass(selector));
        if (section) {
          sections.push(section);
        }
      });
    });
    
    // Strategy 2: Look for common degree audit patterns
    const commonSelectors = [
      '.requirement',
      '.audit-section', 
      '.degree-requirement',
      '[class*="requirement"]',
      '[class*="audit"]',
      '.section',
      'div[class*="block"]',
      'div[class*="area"]'
    ];
    
    commonSelectors.forEach(selector => {
      $(selector).each((index, element) => {
        const $element = $(element);
        
        // Skip if already processed by color class
        if ($element.hasClass('text-auditGray') || 
            $element.hasClass('text-auditBlue') || 
            $element.hasClass('text-auditRed')) {
          return;
        }
        
        const section = extractSectionFromElement($, $element, determineStatusFromContent($element));
        if (section) {
          sections.push(section);
        }
      });
    });
    
    // Strategy 3: Look for table-based layouts (common in degree audits)
    $('table').each((index, table) => {
      const $table = $(table);
      const section = extractSectionFromTable($, $table);
      if (section) {
        sections.push(section);
      }
    });
    
    // Strategy 4: Look for headings followed by content
    $('h1, h2, h3, h4, h5, h6').each((index, heading) => {
      const $heading = $(heading);
      const title = $heading.text().trim();
      
      if (title.length > 3 && isLikelyRequirementTitle(title)) {
        const items = [];
        
        // Look for content after the heading
        let $next = $heading.next();
        while ($next.length > 0 && !$next.is('h1, h2, h3, h4, h5, h6')) {
          const text = $next.text().trim();
          if (text && text.length > 5) {
            // Split by lines if it's a long text block
            const lines = text.split('\\n').map(line => line.trim()).filter(line => line.length > 3);
            items.push(...lines);
          }
          $next = $next.next();
        }
        
        if (items.length > 0) {
          sections.push({
            title,
            status: determineStatusFromContent($heading.parent()),
            items
          });
        }
      }
    });
    
    // Strategy 5: Generic content extraction for any structured content
    if (sections.length === 0) {
      
      // Look for any div with substantial content
      $('div').each((index, div) => {
        const $div = $(div);
        const text = $div.text().trim();
        
        if (text.length > 50) {
          const lines = text.split('\\n')
            .map(line => line.trim())
            .filter(line => line.length > 10);
          
          if (lines.length >= 2) {
            const title = lines[0];
            const items = lines.slice(1);
            
            if (isLikelyRequirementTitle(title)) {
              sections.push({
                title,
                status: determineStatusFromContent($div),
                items
              });
            }
          }
        }
      });
    }
    
    // Strategy 6: Enhanced fallback - extract all text content and look for patterns
    if (sections.length === 0) {
      
      // Get HTML content and replace <br> tags with newlines
      let htmlForProcessing = htmlContent
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n');
      
      const $ = cheerio.load(htmlForProcessing);
      const bodyText = $('body').text();
      
      // Try to identify sections by looking for common patterns
      const allText = bodyText.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 5);
      
      
      let currentTitle = '';
      let currentItems = [];
      
      allText.forEach((line, index) => {
        if (isLikelyRequirementTitle(line) && line.length < 100) {
          // Save previous section if it exists
          if (currentTitle && currentItems.length > 0) {
            sections.push({
              title: currentTitle,
              status: determineStatusFromTextContent(currentItems.join(' ')),
              items: currentItems.slice(0, 10) // Limit items
            });
          }
          // Start new section
          currentTitle = line;
          currentItems = [];
        } else if (currentTitle && line.length > 5) {
          currentItems.push(line);
        }
      });
      
      // Add final section
      if (currentTitle && currentItems.length > 0) {
        sections.push({
          title: currentTitle,
          status: determineStatusFromTextContent(currentItems.join(' ')),
          items: currentItems.slice(0, 10)
        });
      }
    }
    
    
    // Remove duplicates and clean up
    const uniqueSections = [];
    const seenTitles = new Set();
    
    sections.forEach(section => {
      if (!seenTitles.has(section.title) && section.items.length > 0) {
        seenTitles.add(section.title);
        uniqueSections.push(section);
      }
    });
    
    
    return {
      sections: uniqueSections,
      metadata: {
        totalSections: uniqueSections.length,
        fulfilledSections: uniqueSections.filter(s => s.status === 'fulfilled').length,
        inProgressSections: uniqueSections.filter(s => s.status === 'in_progress').length,
        notFulfilledSections: uniqueSections.filter(s => s.status === 'not_fulfilled').length,
        parseTimestamp: new Date().toISOString(),
        htmlLength: htmlContent.length
      }
    };
    
  } catch (error) {
    console.error('[ERROR] HTML parsing failed:', error);
    return {
      sections: [],
      metadata: {
        error: error.message,
        parseTimestamp: new Date().toISOString()
      }
    };
  }
}

function extractSectionFromElement($, $element, status) {
  // Extract title
  let title = '';
  const boldElement = $element.find('b, strong').first();
  if (boldElement.length > 0) {
    title = boldElement.text().trim();
  } else {
    const headingElement = $element.find('h1, h2, h3, h4, h5, h6').first();
    if (headingElement.length > 0) {
      title = headingElement.text().trim();
    } else {
      // Try first paragraph or the element's own text
      const firstP = $element.find('p').first();
      if (firstP.length > 0) {
        title = firstP.text().trim();
      } else {
        const text = $element.text();
        title = text.split('\\n')[0].trim();
      }
    }
  }
  
  // Skip if no meaningful title
  if (!title || title.length < 3) {
    return null;
  }
  
  // Extract items
  const items = [];
  
  // Look for list items
  $element.find('li').each((i, li) => {
    const text = $(li).text().trim();
    if (text && text !== title && text.length > 2) {
      items.push(text);
    }
  });
  
  // Look for paragraphs
  $element.find('p').each((i, p) => {
    const text = $(p).text().trim();
    if (text && text !== title && text.length > 2) {
      items.push(text);
    }
  });
  
  // If no structured content, split by line breaks
  if (items.length === 0) {
    const fullText = $element.text();
    const lines = fullText.split('\\n')
      .map(line => line.trim())
      .filter(line => line && line !== title && line.length > 3);
    items.push(...lines);
  }
  
  // Only return section if it has meaningful content
  if (title && items.length > 0) {
    return {
      title,
      status,
      items: items.slice(0, 20) // Limit items to prevent overwhelming output
    };
  }
  
  return null;
}

function extractSectionFromTable($, $table) {
  const rows = [];
  $table.find('tr').each((i, tr) => {
    const cells = [];
    $(tr).find('td, th').each((j, cell) => {
      const text = $(cell).text().trim();
      if (text) {
        cells.push(text);
      }
    });
    if (cells.length > 0) {
      rows.push(cells.join(' - '));
    }
  });
  
  if (rows.length >= 2) {
    return {
      title: rows[0] || 'Table Section',
      status: 'in_progress',
      items: rows.slice(1)
    };
  }
  
  return null;
}

function getStatusFromClass(selector) {
  if (selector.includes('auditGray')) return 'fulfilled';
  if (selector.includes('auditBlue')) return 'in_progress';
  if (selector.includes('auditRed')) return 'not_fulfilled';
  return 'not_fulfilled';
}

function determineStatusFromContent($element) {
  const text = $element.text().toLowerCase();
  return determineStatusFromTextContent(text);
}

function determineStatusFromTextContent(text) {
  const textLower = text.toLowerCase();
  
  // Look for completion indicators
  if (textLower.includes('complete') || 
      textLower.includes('satisfied') || 
      textLower.includes('fulfilled') ||
      textLower.includes('passed') ||
      textLower.includes('earned') ||
      textLower.includes('100%') ||
      textLower.includes('done')) {
    return 'fulfilled';
  }
  
  // Look for in-progress indicators
  if (textLower.includes('in progress') || 
      textLower.includes('current') || 
      textLower.includes('enrolled') ||
      textLower.includes('taking') ||
      textLower.includes('partial')) {
    return 'in_progress';
  }
  
  // Look for not-fulfilled indicators
  if (textLower.includes('not') || 
      textLower.includes('missing') || 
      textLower.includes('required') ||
      textLower.includes('needed') ||
      textLower.includes('outstanding') ||
      textLower.includes('0%') ||
      textLower.includes('none')) {
    return 'not_fulfilled';
  }
  
  // Default to in_progress
  return 'in_progress';
}

function isLikelyRequirementTitle(title) {
  const titleLower = title.toLowerCase();
  const keywords = [
    'requirement', 'division', 'major', 'college', 'general',
    'education', 'course', 'unit', 'credit', 'math', 'science',
    'english', 'writing', 'language', 'elective', 'core',
    'foundation', 'breadth', 'depth', 'concentration', 'degree',
    'bachelor', 'master', 'lower', 'upper', 'graduation', 'audit',
    'data science', 'computer science', 'engineering', 'physics',
    'chemistry', 'biology', 'history', 'literature', 'arts',
    'social', 'humanities', 'ethnic', 'international', 'studies'
  ];
  
  // Check for common course codes (e.g., CSE, MATH, CHEM, etc.)
  const courseCodePattern = /[A-Z]{2,4}\s*\d+/;
  
  // Skip lines that look like individual courses rather than section titles
  if (courseCodePattern.test(title) && title.includes(' - ')) {
    return false;
  }
  
  return keywords.some(keyword => titleLower.includes(keyword)) || 
         (title.length > 15 && title.length < 100); // Reasonable title length
}

// CLI usage for testing
if (process.argv.length > 2) {
  const htmlFilePath = process.argv[2];
  const result = parseHtmlAudit(htmlFilePath);
}