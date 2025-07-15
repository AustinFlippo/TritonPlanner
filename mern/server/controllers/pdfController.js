import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const exportToPdf = async (req, res) => {
  try {
    const { studentName, schedule } = req.body;

    // Create a new PDF document in portrait orientation
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // Letter size, portrait (8.5x11)
    
    // Get form for fillable fields
    const form = pdfDoc.getForm();
    
    // Embed fonts
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    // Define colors
    const blueColor = rgb(0.29, 0.56, 0.89); // #4A90E2
    const whiteColor = rgb(1, 1, 1);
    const lightGrayColor = rgb(0.918, 0.918, 0.918); // #EAEAEA
    const darkGrayColor = rgb(0.75, 0.75, 0.75);
    const blackColor = rgb(0, 0, 0);
    
    // Layout constants (coordinate-based)
    const pageWidth = 595;
    const pageHeight = 842;
    const margin = 50;
    const yearBlockWidth = pageWidth - (2 * margin); // 495 points
    const yearBlockHeight = 170;
    const yearBlockGap = 20;
    const yearHeaderHeight = 30;
    const termColumnWidth = yearBlockWidth / 3; // 165 points each
    const courseSlotWidth = 155;
    const courseSlotHeight = 35;
    const courseSlotGap = 5;
    
    // Add title
    if (studentName) {
      page.drawText(`Academic Plan - ${studentName}`, {
        x: margin,
        y: pageHeight - margin - 20,
        size: 16,
        font: boldFont,
        color: blackColor,
      });
    }
    
    // Starting Y position for first year block
    let currentY = pageHeight - margin - 50;
    
    // Process each year (maximum 4 years to fit on one page)
    for (let yearIndex = 0; yearIndex < Math.min(schedule.length, 4); yearIndex++) {
      const yearData = schedule[yearIndex];
      
      // Draw the outer year-block rectangle
      page.drawRectangle({
        x: margin,
        y: currentY - yearBlockHeight,
        width: yearBlockWidth,
        height: yearBlockHeight,
        color: lightGrayColor,
        borderColor: darkGrayColor,
        borderWidth: 1,
      });
      
      // Draw the blue year header
      page.drawRectangle({
        x: margin,
        y: currentY - yearHeaderHeight,
        width: yearBlockWidth,
        height: yearHeaderHeight,
        color: blueColor,
      });
      
      // Year title (left-aligned)
      page.drawText(yearData.year, {
        x: margin + 15,
        y: currentY - yearHeaderHeight + 8,
        size: 14,
        font: boldFont,
        color: whiteColor,
      });
      
      // Calculate annual units from terms
      const annualUnits = yearData.terms.reduce((sum, term) => sum + (term.termUnits || 0), 0);
      
      // Annual units display (right-aligned)
      const annualUnitsText = `Annual Units: ${annualUnits}`;
      const annualUnitsWidth = font.widthOfTextAtSize(annualUnitsText, 12);
      page.drawText(annualUnitsText, {
        x: margin + yearBlockWidth - annualUnitsWidth - 15,
        y: currentY - yearHeaderHeight + 8,
        size: 12,
        font: boldFont,
        color: whiteColor,
      });
      
      // Draw the three term columns
      const termNames = ['Fall', 'Winter', 'Spring'];
      const termStartY = currentY - yearHeaderHeight - 10;
      
      for (let termIndex = 0; termIndex < 3; termIndex++) {
        const termData = yearData.terms[termIndex];
        const termX = margin + (termIndex * termColumnWidth);
        
        // Draw term sub-header
        page.drawText(termNames[termIndex], {
          x: termX + 10,
          y: termStartY,
          size: 12,
          font: boldFont,
          color: blackColor,
        });
        
        // Calculate term units from courses
        const termUnits = termData?.courses?.reduce((sum, course) => {
          return sum + (course ? (course.units || 4) : 0);
        }, 0) || 0;
        
        // Draw term units
        const termUnitsText = `${termUnits} units`;
        const termUnitsWidth = font.widthOfTextAtSize(termUnitsText, 10);
        page.drawText(termUnitsText, {
          x: termX + termColumnWidth - termUnitsWidth - 10,
          y: termStartY,
          size: 10,
          font,
          color: blackColor,
        });
        
        // Draw three course slots for this term
        for (let courseIndex = 0; courseIndex < 3; courseIndex++) {
          const course = termData?.courses[courseIndex];
          const slotX = termX + 5;
          const slotY = termStartY - 25 - (courseIndex * (courseSlotHeight + courseSlotGap));
          
          // Draw course slot rectangle (white background)
          page.drawRectangle({
            x: slotX,
            y: slotY - courseSlotHeight,
            width: courseSlotWidth,
            height: courseSlotHeight,
            color: whiteColor,
            borderColor: darkGrayColor,
            borderWidth: 1,
          });
          
          if (course && (course.id || course.name)) {
            // Draw course information
            const courseCode = course.id || course.code || '';
            const courseTitle = course.name || course.title || '';
            
            if (courseCode) {
              page.drawText(courseCode, {
                x: slotX + 5,
                y: slotY - 15,
                size: 10,
                font: boldFont,
                color: blackColor,
              });
            }
            
            if (courseTitle) {
              // Truncate long titles to fit
              let titleText = courseTitle;
              if (titleText.length > 25) {
                titleText = titleText.substring(0, 22) + '...';
              }
              page.drawText(titleText, {
                x: slotX + 5,
                y: slotY - 28,
                size: 8,
                font,
                color: blackColor,
              });
            }
          } else {
            // Create fillable text field for empty slots
            const fieldName = `${yearData.year}_${termNames[termIndex]}_slot_${courseIndex}`;
            const textField = form.createTextField(fieldName);
            textField.setText('Empty Slot');
            textField.enableMultiline();
            
            textField.addToPage(page, {
              x: slotX + 1,
              y: slotY - courseSlotHeight + 1,
              width: courseSlotWidth - 2,
              height: courseSlotHeight - 2,
              font,
              textColor: rgb(0.5, 0.5, 0.5),
              backgroundColor: whiteColor,
              borderColor: darkGrayColor,
              borderWidth: 1,
            });
            
            // Set font size after adding to page to avoid DA entry error
            try {
              textField.setFontSize(9);
            } catch (error) {
              console.warn('Could not set font size for text field:', error.message);
            }
          }
        }
      }
      
      // Update Y position for next year block
      currentY = currentY - yearBlockHeight - yearBlockGap;
    }
    
    // Serialize the PDF document
    const pdfBytes = await pdfDoc.save();
    
    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="academic-schedule.pdf"');
    
    // Send the PDF
    res.send(Buffer.from(pdfBytes));
    
  } catch (error) {
    console.error('Failed to generate PDF:', error);
    res.status(500).send({ message: 'Error generating PDF schedule.' });
  }
};

export { exportToPdf };