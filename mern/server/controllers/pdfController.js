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
    
    // Layout constants (coordinate-based) - reduced for better fit
    const pageWidth = 595;
    const pageHeight = 842;
    const margin = 40;
    const yearBlockWidth = pageWidth - (2 * margin); // 515 points
    const yearBlockHeight = 155; // Reduced from 170
    const yearBlockGap = 15; // Reduced from 20
    const yearHeaderHeight = 25; // Reduced from 30
    const termColumnWidth = yearBlockWidth / 3; // ~171 points each
    const courseSlotWidth = 165; // Slightly increased
    const courseSlotHeight = 30; // Reduced from 35
    const courseSlotGap = 4; // Reduced from 5
    
    // Add title
    if (studentName) {
      page.drawText(`Academic Plan - ${studentName}`, {
        x: margin,
        y: pageHeight - margin - 15,
        size: 14, // Reduced from 16
        font: boldFont,
        color: blackColor,
      });
    }
    
    // Starting Y position for first year block
    let currentY = pageHeight - margin - 40;
    
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
      
      // Year title (left-aligned) - adjusted for smaller header
      page.drawText(yearData.year, {
        x: margin + 12,
        y: currentY - yearHeaderHeight + 6,
        size: 12, // Reduced from 14
        font: boldFont,
        color: whiteColor,
      });
      
      // Calculate annual units from terms
      const annualUnits = yearData.terms.reduce((sum, term) => sum + (term.termUnits || 0), 0);
      
      // Annual units display (right-aligned) - adjusted for smaller header
      const annualUnitsText = `Annual Units: ${annualUnits}`;
      const annualUnitsWidth = font.widthOfTextAtSize(annualUnitsText, 10);
      page.drawText(annualUnitsText, {
        x: margin + yearBlockWidth - annualUnitsWidth - 12,
        y: currentY - yearHeaderHeight + 6,
        size: 10, // Reduced from 12
        font: boldFont,
        color: whiteColor,
      });
      
      // Draw the three term columns
      const termNames = ['Fall', 'Winter', 'Spring'];
      const termStartY = currentY - yearHeaderHeight - 10;
      
      for (let termIndex = 0; termIndex < 3; termIndex++) {
        const termData = yearData.terms[termIndex];
        const termX = margin + (termIndex * termColumnWidth);
        
        // Draw term sub-header - adjusted for smaller layout
        page.drawText(termNames[termIndex], {
          x: termX + 8,
          y: termStartY,
          size: 11, // Reduced from 12
          font: boldFont,
          color: blackColor,
        });
        
        // Calculate term units from courses
        const termUnits = termData?.courses?.reduce((sum, course) => {
          return sum + (course ? (course.units || 4) : 0);
        }, 0) || 0;
        
        // Draw term units - adjusted for smaller layout
        const termUnitsText = `${termUnits} units`;
        const termUnitsWidth = font.widthOfTextAtSize(termUnitsText, 9);
        page.drawText(termUnitsText, {
          x: termX + termColumnWidth - termUnitsWidth - 8,
          y: termStartY,
          size: 9, // Reduced from 10
          font,
          color: blackColor,
        });
        
        // Draw three course slots for this term
        for (let courseIndex = 0; courseIndex < 3; courseIndex++) {
          const course = termData?.courses[courseIndex];
          const slotX = termX + 3;
          const slotY = termStartY - 20 - (courseIndex * (courseSlotHeight + courseSlotGap));
          
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
                x: slotX + 4,
                y: slotY - 12, // Adjusted for smaller slot
                size: 9, // Reduced from 10
                font: boldFont,
                color: blackColor,
              });
            }
            
            if (courseTitle) {
              // Truncate long titles to fit smaller space
              let titleText = courseTitle;
              if (titleText.length > 28) {
                titleText = titleText.substring(0, 25) + '...';
              }
              page.drawText(titleText, {
                x: slotX + 4,
                y: slotY - 23, // Adjusted for smaller slot
                size: 7, // Reduced from 8
                font,
                color: blackColor,
              });
            }
          } else {
            // Create two separate fillable fields for empty slots
            // Field 1: Course ID (bold, matches existing course code styling)
            const courseIdFieldName = `${yearData.year}_${termNames[termIndex]}_slot_${courseIndex}_id`;
            const courseIdField = form.createTextField(courseIdFieldName);
            courseIdField.setText('Course ID');
            
            courseIdField.addToPage(page, {
              x: slotX + 4,
              y: slotY - 18, // Adjusted for smaller slot
              width: courseSlotWidth - 8,
              height: 12, // Reduced from 15
              font: boldFont,
              textColor: rgb(0.5, 0.5, 0.5),
              backgroundColor: whiteColor,
              borderColor: rgb(0.8, 0.8, 0.8),
              borderWidth: 0.5,
            });
            
            // Set font size for course ID field
            try {
              courseIdField.setFontSize(9); // Reduced from 10
            } catch (error) {
              console.warn('Could not set font size for course ID field:', error.message);
            }
            
            // Field 2: Course Name (normal font, matches existing course title styling)
            const courseNameFieldName = `${yearData.year}_${termNames[termIndex]}_slot_${courseIndex}_name`;
            const courseNameField = form.createTextField(courseNameFieldName);
            courseNameField.setText('Course Name');
            courseNameField.enableMultiline();
            
            courseNameField.addToPage(page, {
              x: slotX + 4,
              y: slotY - 29, // Adjusted for smaller slot
              width: courseSlotWidth - 8,
              height: 8, // Reduced from 10
              font,
              textColor: rgb(0.5, 0.5, 0.5),
              backgroundColor: whiteColor,
              borderColor: rgb(0.8, 0.8, 0.8),
              borderWidth: 0.5,
            });
            
            // Set font size for course name field
            try {
              courseNameField.setFontSize(7); // Reduced from 8
            } catch (error) {
              console.warn('Could not set font size for course name field:', error.message);
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