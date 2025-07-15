import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const exportToPdf = async (req, res) => {
  try {
    const { studentName, schedule } = req.body;

    // Create a new PDFDocument
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const form = pdfDoc.getForm();

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let y = height - 60; // Initial Y position

    // Add student name at the top
    if (studentName) {
      page.drawText(`Student Name: ${studentName}`, {
        x: 50,
        y: y + 20,
        font,
        size: 14,
        color: rgb(0, 0, 0),
      });
    }

    // Process each year and term
    for (const year of schedule) {
      for (const term of year.terms) {
        // Draw term header
        page.drawText(term.term, {
          x: 50,
          y,
          font: boldFont,
          size: 12,
        });
        y -= 25; // Space after header

        // Process each course in the term
        for (let i = 0; i < term.courses.length; i++) {
          const course = term.courses[i];
          const courseText = `${course.id}: ${course.name}`;

          // Create a unique name for the form field
          const fieldName = `${term.term.replace(/\s+/g, '_')}_course_${i}`;

          const textField = form.createTextField(fieldName);
          textField.setText(courseText);

          // Add the field to the page
          textField.addToPage(page, {
            x: 60,
            y: y,
            width: width - 120,
            height: 15,
            font,
            textColor: rgb(0, 0, 0),
            backgroundColor: rgb(0.95, 0.95, 0.95),
            borderColor: rgb(0.75, 0.75, 0.75),
            borderWidth: 1,
          });

          y -= 20; // Move down for the next course

          // Add a new page if content overflows
          if (y < 40) {
            page = pdfDoc.addPage();
            y = page.getHeight() - 60;
          }
        }
        y -= 15; // Extra space between terms
      }
    }

    // Serialize the PDFDocument to bytes (a Uint8Array)
    const pdfBytes = await pdfDoc.save();

    // Set headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="academic-schedule.pdf"');

    // Send the PDF to the client
    res.send(Buffer.from(pdfBytes));

  } catch (error) {
    console.error('Failed to generate PDF:', error);
    res.status(500).send({ message: 'Error generating PDF schedule.' });
  }
};

export { exportToPdf };