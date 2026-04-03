import { jsPDF } from "jspdf";
import { CVData } from "./gemini";

export const exportToSelectablePDF = (data: CVData, filename: string, template: string = "modern") => {
  try {
    const doc = new jsPDF({
      orientation: "p",
      unit: "mm",
      format: "a4",
    });

    const margin = template === "minimal" ? 25 : 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const contentWidth = pageWidth - margin * 2;
    let y = margin;

    const checkPageBreak = (neededHeight: number) => {
      if (y + neededHeight > 280) {
        doc.addPage();
        y = margin;
        return true;
      }
      return false;
    };

    const renderMarkdownText = (text: string, x: number, currentY: number, maxWidth: number, baseFont: string = "helvetica", fontSize: number = 10, color: [number, number, number] = [50, 50, 50], bullet: string = "") => {
      doc.setFont(baseFont, "normal");
      doc.setFontSize(fontSize);
      doc.setTextColor(color[0], color[1], color[2]);

      const lineHeight = fontSize * 0.45; // mm (approx 1.2-1.3 line height)
      
      // Split by lines first to preserve manual line breaks if any
      const rawLines = text.split("\n");
      let localY = currentY;

      rawLines.forEach((rawLine, lineIdx) => {
        const parts = rawLine.split(/(\*\*.*?\*\*)/g);
        
        let lineWords: { text: string, bold: boolean }[] = [];
        parts.forEach(part => {
          const isBold = part.startsWith("**") && part.endsWith("**");
          const cleanPart = isBold ? part.slice(2, -2) : part;
          const words = cleanPart.split(" ");
          words.forEach((w, i) => {
            if (w || i < words.length - 1) {
              lineWords.push({ text: w + (i === words.length - 1 ? "" : " "), bold: isBold });
            }
          });
        });

        // Render bullet only on the first line of the markdown block
        if (bullet && lineIdx === 0) {
          doc.setFont(baseFont, "normal");
          doc.text(bullet, x - 5, localY);
        }

        let currentLineX = x;
        lineWords.forEach((wordObj, index) => {
          doc.setFont(baseFont, wordObj.bold ? "bold" : "normal");
          const wordWidth = doc.getTextWidth(wordObj.text);

          if (currentLineX + wordWidth > margin + maxWidth && index > 0) {
            currentLineX = x;
            localY += lineHeight;
            if (localY > 280) {
              doc.addPage();
              localY = margin;
            }
          }

          doc.text(wordObj.text, currentLineX, localY);
          currentLineX += wordWidth;
        });
        
        localY += lineHeight;
        if (localY > 280) {
          doc.addPage();
          localY = margin;
        }
      });

      return localY;
    };

    const renderLinkedText = (text: string, x: number, currentY: number, url: string, fontSize: number) => {
      doc.text(text, x, currentY);
      const textWidth = doc.getTextWidth(text);
      // Create a clickable link area
      doc.link(x, currentY - (fontSize * 0.7), textWidth, fontSize * 0.8, { url });
    };

    if (template === "modern") {
      // --- Modern Template Style ---
      doc.setFont("helvetica", "bold");
      doc.setFontSize(28);
      doc.setTextColor(15, 23, 42); // Slate-900
      doc.text(data.personalInfo.fullName, margin, y);
      y += 10;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139); // Slate-500
      const contactParts = [
        data.personalInfo.phone,
        data.personalInfo.location,
      ].filter(Boolean);
      
      let currentContactX = margin;
      
      // Email as a link
      if (data.personalInfo.email) {
        doc.setTextColor(79, 70, 229);
        renderLinkedText(data.personalInfo.email, currentContactX, y, `mailto:${data.personalInfo.email}`, 9);
        currentContactX += doc.getTextWidth(data.personalInfo.email) + 6;
        doc.setTextColor(100, 116, 139);
      }

      contactParts.forEach((part) => {
        doc.text(part, currentContactX, y);
        currentContactX += doc.getTextWidth(part) + 6;
      });

      const headerLinks = data.customLinks?.filter(link => link.position === "header" || (!link.position && data.linksPlacement === "header")) || [];
      if (headerLinks.length > 0) {
        headerLinks.forEach((link) => {
          if (link.title && link.url) {
            doc.setTextColor(79, 70, 229); // Indigo-600 for links
            renderLinkedText(link.title, currentContactX, y, link.url, 9);
            currentContactX += doc.getTextWidth(link.title) + 6;
            doc.setTextColor(100, 116, 139); // Reset to Slate-500
          }
        });
      }
      y += 6;

      // Indigo Border Bottom
      doc.setDrawColor(79, 70, 229); // Indigo-600
      doc.setLineWidth(0.8);
      doc.line(margin, y, margin + 40, y); // Short thick line like the design
      y += 12;

      // Summary
      if (data.summary) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(79, 70, 229); // Indigo-600
        doc.text("PROFESSIONAL SUMMARY", margin, y);
        y += 6;

        y = renderMarkdownText(data.summary, margin, y, contentWidth, "helvetica", 9.5, [71, 85, 105]);
        y += 10;
      }

      // Experience
      if (data.experience?.length > 0) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(79, 70, 229);
        doc.text("EXPERIENCE", margin, y);
        y += 8;

        data.experience.forEach((exp, index) => {
          // Robust keep-together for header (Company, Position, Dates)
          checkPageBreak(35);
          
          // Clear separation between roles
          if (index > 0) {
            y += 15;
          }

          // 1. Company Name & Dates (Standard ATS Pattern)
          const companyText = exp.company || exp.position;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.setTextColor(15, 23, 42);
          doc.text(companyText, margin, y);
          
          // Right-aligned dates
          const dates = `${exp.startDate} - ${exp.endDate}`;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(10);
          const datesWidth = doc.getTextWidth(dates);
          doc.text(dates, margin + contentWidth - datesWidth, y);
          y += 5;

          // 2. Job Title & Location
          const positionText = exp.company ? exp.position : "";
          if (positionText) {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            doc.setTextColor(51, 65, 85);
            doc.text(positionText, margin, y);
            
            if (exp.location) {
              doc.setFont("helvetica", "normal");
              doc.setFontSize(9.5);
              const locWidth = doc.getTextWidth(exp.location);
              doc.text(exp.location, margin + contentWidth - locWidth, y);
            }
            y += 7;
          } else {
            y += 2;
          }

          exp.highlights.forEach((h) => {
            checkPageBreak(15);
            // Reasonable indentation for bullet points
            y = renderMarkdownText(h, margin + 6, y, contentWidth - 6, "helvetica", 9.5, [71, 85, 105], "•");
            y += 2;
          });
        });
      }

      // Education & Skills Grid
      checkPageBreak(40);
      const colWidth = (contentWidth / 2) - 5;
      const secondColX = margin + colWidth + 10;
      
      // Education
      let eduY = y;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(79, 70, 229);
      doc.text("EDUCATION", margin, eduY);
      eduY += 8;

      data.education?.forEach((edu) => {
        checkPageBreak(20);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(15, 23, 42);
        const degreeLines = doc.splitTextToSize(edu.degree, colWidth);
        doc.text(degreeLines, margin, eduY);
        eduY += (degreeLines.length * 4);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(51, 65, 85);
        const schoolLines = doc.splitTextToSize(edu.school, colWidth);
        doc.text(schoolLines, margin, eduY);
        eduY += (schoolLines.length * 4);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(edu.graduationDate, margin, eduY);
        eduY += 8;
      });

      // Skills
      let skillY = y;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(79, 70, 229);
      doc.text("SKILLS", secondColX, skillY);
      skillY += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(51, 65, 85);
      
      let currentX = secondColX;
      data.skills?.forEach((skill) => {
        const textWidth = doc.getTextWidth(skill);
        const pillPadding = 2;
        const pillWidth = textWidth + (pillPadding * 2);
        const pillHeight = 6;

        if (currentX + pillWidth > pageWidth - margin) {
          currentX = secondColX;
          skillY += pillHeight + 2;
          checkPageBreak(pillHeight + 2);
        }

        // Draw Pill Background (Slate-100)
        doc.setFillColor(241, 245, 249);
        doc.roundedRect(currentX, skillY - 4, pillWidth, pillHeight, 1, 1, "F");
        
        // Draw Skill Text
        doc.setTextColor(51, 65, 85);
        doc.text(skill, currentX + pillPadding, skillY);
        
        currentX += pillWidth + 2;
      });

      // Bottom Links Section for Modern
      const bottomLinks = data.customLinks?.filter(link => link.position === "bottom" || (!link.position && data.linksPlacement === "bottom")) || [];
      if (bottomLinks.length > 0) {
        y = Math.max(eduY, skillY) + 15;
        checkPageBreak(20);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(79, 70, 229);
        doc.text("LINKS", margin, y);
        y += 8;
    
        let linkX = margin;
        bottomLinks.forEach((link) => {
          if (link.title && link.url) {
            const linkWidth = doc.getTextWidth(link.title);
            if (linkX + linkWidth > pageWidth - margin) {
              linkX = margin;
              y += 6;
              checkPageBreak(6);
            }
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
            doc.setTextColor(79, 70, 229);
            renderLinkedText(link.title, linkX, y, link.url, 9);
            linkX += linkWidth + 10;
          }
        });
      }

    } else {
      // --- Minimal Template Style ---
      doc.setFont("helvetica", "normal");
      doc.setFontSize(36);
      doc.setTextColor(15, 23, 42);
      const nameWidth = doc.getTextWidth(data.personalInfo.fullName);
      doc.text(data.personalInfo.fullName, (pageWidth - nameWidth) / 2, y + 10);
      y += 20;

      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      
      const contactParts = [
        { text: data.personalInfo.email, isEmail: true },
        { text: data.personalInfo.phone },
        { text: data.personalInfo.location },
      ].filter(p => p.text);

      const headerLinks = data.customLinks?.filter(link => link.position === "header" || (!link.position && data.linksPlacement === "header")) || [];
      
      const allItems = [
        ...contactParts.map(p => ({ 
          text: p.text!.toUpperCase(), 
          url: p.isEmail ? `mailto:${p.text}` : null
        })),
        ...headerLinks.map(l => ({ text: l.title!.toUpperCase(), url: l.url!.startsWith('http') ? l.url : `https://${l.url}` }))
      ];

      const contactStr = allItems.map(i => i.text).join("  •  ");
      const contactWidth = doc.getTextWidth(contactStr);
      let startX = (pageWidth - contactWidth) / 2;
      
      allItems.forEach((item, i) => {
        if (item.url) {
          doc.setTextColor(79, 70, 229);
          renderLinkedText(item.text, startX, y, item.url, 8);
        } else {
          doc.setTextColor(100, 116, 139);
          doc.text(item.text, startX, y);
        }
        startX += doc.getTextWidth(item.text);
        if (i < allItems.length - 1) {
          doc.setTextColor(100, 116, 139);
          doc.text("  •  ", startX, y);
          startX += doc.getTextWidth("  •  ");
        }
      });
      y += 15;

      // Summary
      if (data.summary) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(11);
        doc.setTextColor(71, 85, 105);
        y = renderMarkdownText(data.summary, margin + 10, y, contentWidth - 20, "helvetica", 11, [71, 85, 105]);
        y += 15;
      }

      // Experience
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text("EXPERIENCE", margin, y);
      y += 2;
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y, pageWidth - margin, y);
      y += 8;

      data.experience?.forEach((exp, index) => {
        checkPageBreak(35);
        
        if (index > 0) {
          y += 20;
        }

        // 1. Company & Dates
        const companyText = exp.company || exp.position;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(15, 23, 42);
        doc.text(companyText, margin, y);
        
        const dates = `${exp.startDate} - ${exp.endDate}`;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        const datesWidth = doc.getTextWidth(dates);
        doc.text(dates, margin + contentWidth - datesWidth, y);
        y += 6;

        // 2. Position & Location
        const positionText = exp.company ? exp.position : "";
        if (positionText) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(11);
          doc.setTextColor(71, 85, 105);
          doc.text(positionText.toUpperCase(), margin, y);
          
          if (exp.location) {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            const locWidth = doc.getTextWidth(exp.location);
            doc.text(exp.location, margin + contentWidth - locWidth, y);
          }
          y += 8;
        }

        exp.highlights.forEach((h) => {
          checkPageBreak(15);
          y = renderMarkdownText(h, margin + 6, y, contentWidth - 6, "helvetica", 10.5, [71, 85, 105], "•");
          y += 2;
        });
      });

      // Education & Skills
      y += 5;
      const colWidth = contentWidth / 2;
      
      // Education
      let eduY = y;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text("EDUCATION", margin, eduY);
      eduY += 2;
      doc.line(margin, eduY, margin + colWidth - 5, eduY);
      eduY += 8;

      data.education?.forEach((edu) => {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text(edu.school, margin, eduY);
        eduY += 4;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text(edu.degree, margin, eduY);
        eduY += 4;
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8);
        doc.text(edu.graduationDate, margin, eduY);
        eduY += 10;
      });

      // Expertise
      let skillY = y;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(15, 23, 42);
      doc.text("EXPERTISE", margin + colWidth + 5, skillY);
      skillY += 2;
      doc.line(margin + colWidth + 5, skillY, pageWidth - margin, skillY);
      skillY += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(71, 85, 105);
      data.skills?.forEach((skill) => {
        doc.text(skill, margin + colWidth + 5, skillY);
        skillY += 5;
      });

      // Bottom Links Section for Minimal
      const bottomLinks = data.customLinks?.filter(link => link.position === "bottom" || (!link.position && data.linksPlacement === "bottom")) || [];
      if (bottomLinks.length > 0) {
        y = Math.max(eduY, skillY) + 15;
        checkPageBreak(20);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.setTextColor(15, 23, 42);
        doc.text("LINKS", margin, y);
        y += 2;
        doc.line(margin, y, pageWidth - margin, y);
        y += 8;

        let linkX = margin;
        bottomLinks.forEach((link) => {
          if (link.title && link.url) {
            const linkWidth = doc.getTextWidth(link.title);
            if (linkX + linkWidth > pageWidth - margin) {
              linkX = margin;
              y += 6;
              checkPageBreak(6);
            }
            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            doc.setTextColor(79, 70, 229);
            renderLinkedText(link.title, linkX, y, link.url, 10);
            linkX += linkWidth + 15;
          }
        });
      }
    }

    doc.save(`${filename || "CV"}.pdf`);
  } catch (error) {
    console.error("Error generating standard PDF:", error);
    alert("Failed to generate PDF. Please try again.");
  }
};

export const exportForPlatforms = (data: CVData, filename: string) => {
  console.log("Starting Plain Text Export for:", filename);
  try {
    let text = "";

    // 1. Header
    const fullName = (data.personalInfo?.fullName || "RESUME").trim();
    text += `${fullName.toUpperCase()}\n`;
    text += "=".repeat(fullName.length) + "\n\n";

    const contactInfo = [
      data.personalInfo?.email,
      data.personalInfo?.phone,
      data.personalInfo?.location
    ].filter(Boolean).join("  |  ");
    
    if (contactInfo) {
      text += `${contactInfo}\n`;
    }

    const headerLinks = data.customLinks?.filter(link => link.position === "header" || (!link.position && data.linksPlacement === "header")) || [];
    if (headerLinks.length > 0) {
      text += headerLinks.map(l => `${l.title}: ${l.url}`).join("  |  ") + "\n";
    }
    text += "\n";

    // 2. Summary
    if (data.summary) {
      text += "PROFESSIONAL SUMMARY\n";
      text += "--------------------\n";
      text += `${data.summary}\n\n`;
    }

    // 3. Experience
    if (data.experience && data.experience.length > 0) {
      text += "PROFESSIONAL EXPERIENCE\n";
      text += "-----------------------\n";

      data.experience.forEach((exp) => {
        if (!exp) return;
        
        text += `${(exp.company || "Company").toUpperCase()}\n`;
        text += `${exp.position || "Position"}  |  ${exp.startDate || ""} - ${exp.endDate || "Present"}\n`;
        if (exp.location) {
          text += `${exp.location}\n`;
        }

        if (exp.highlights && Array.isArray(exp.highlights)) {
          exp.highlights.forEach((h) => {
            if (!h) return;
            const cleanH = String(h).replace(/\*\*/g, ""); // Remove markdown bolding
            text += `- ${cleanH}\n`;
          });
        }
        text += "\n";
      });
    }

    // 4. Education
    if (data.education && data.education.length > 0) {
      text += "EDUCATION\n";
      text += "---------\n";

      data.education.forEach((edu) => {
        if (!edu) return;
        text += `${(edu.school || "University").toUpperCase()}\n`;
        text += `${edu.degree || ""}${edu.graduationDate ? `  |  ${edu.graduationDate}` : ""}\n`;
        if (edu.location) {
          text += `${edu.location}\n`;
        }
        text += "\n";
      });
    }

    // 5. Skills
    if (data.skills && data.skills.length > 0) {
      text += "SKILLS & EXPERTISE\n";
      text += "------------------\n";
      const skillsStr = Array.isArray(data.skills) ? data.skills.join(", ") : String(data.skills);
      text += `${skillsStr}\n\n`;
    }

    // 6. Additional Links
    const bottomLinks = data.customLinks?.filter(link => link.position === "bottom" || (!link.position && data.linksPlacement === "bottom")) || [];
    if (bottomLinks.length > 0) {
      text += "ADDITIONAL LINKS\n";
      text += "----------------\n";
      bottomLinks.forEach(link => {
        if (!link || !link.title || !link.url) return;
        text += `${link.title}: ${link.url}\n`;
      });
      text += "\n";
    }

    // Trigger download
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const finalFilename = (filename || "CV").trim() || "CV";
    link.download = `${finalFilename}_Platform.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log("Plain Text Export Complete");
  } catch (error) {
    console.error("Error generating plain text file:", error);
    alert("Failed to generate text file. Please try again or use the 'Copy ATS Text' option.");
  }
};
