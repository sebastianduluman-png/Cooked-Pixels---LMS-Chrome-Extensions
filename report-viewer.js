/**
 * Report Viewer — loads report data from chrome.storage.local,
 * renders it, and provides PDF download via html2pdf.js.
 */
(function () {
  "use strict";

  var btn = document.getElementById("dlBtn");
  var status = document.getElementById("dlStatus");
  var container = document.getElementById("reportContainer");
  var bar = document.getElementById("dlBar");
  var spacer = document.querySelector(".report-spacer");

  chrome.storage.local.get("_reportData", function (result) {
    var data = result._reportData;
    if (!data || !data.html) {
      status.textContent = "Eroare: niciun raport disponibil. Inchideti tab-ul si generati din nou.";
      return;
    }

    // Inject report CSS
    var style = document.createElement("style");
    style.textContent = data.css;
    document.head.appendChild(style);

    // Inject report HTML
    container.innerHTML = data.html;
    document.title = "Raport Tracking - " + (data.domain || "");
    status.textContent = "Raportul este gata. Apasa butonul pentru a genera PDF-ul.";
    btn.disabled = false;

    // Clean up storage
    chrome.storage.local.remove("_reportData");

    // PDF download handler
    btn.addEventListener("click", function () {
      btn.disabled = true;
      btn.textContent = "Se genereaza...";
      status.textContent = "Se genereaza PDF-ul, va rugam asteptati...";

      var el = document.querySelector(".report");
      if (!el) {
        btn.disabled = false;
        btn.textContent = "Descarca PDF";
        status.textContent = "Eroare: elementul .report nu a fost gasit.";
        return;
      }

      // Hide UI elements so they don't appear in the PDF
      bar.style.display = "none";
      spacer.style.display = "none";

      // Force report to A4 width, remove centering, anchor to left
      el.style.width = "794px";
      el.style.maxWidth = "794px";
      el.style.margin = "0";
      el.style.padding = "0";
      container.style.width = "794px";
      container.style.overflow = "hidden";

      // Wait a frame for layout to settle, then measure and generate
      requestAnimationFrame(function () {
        var rect = el.getBoundingClientRect();
        // Convert px to mm: 794px = 210mm (A4), so ratio = 210/794
        var ratio = 210 / 794;
        var heightMm = Math.ceil(rect.height * ratio) + 5;

        html2pdf()
          .set({
            margin: [0, 0, 0, 0],
            filename: data.filename || "tracking-audit.pdf",
            image: { type: "jpeg", quality: 0.98 },
            html2canvas: {
              scale: 2,
              useCORS: true,
              backgroundColor: "#1a1a2e",
              logging: false,
              width: 794,
              windowWidth: 794,
              scrollX: 0,
              scrollY: 0,
              x: 0,
              y: 0,
            },
            jsPDF: { unit: "mm", format: [210, heightMm], orientation: "portrait" },
          })
          .from(el)
          .save()
          .then(function () {
            bar.style.display = "flex";
            spacer.style.display = "block";
            el.style.width = "";
            el.style.maxWidth = "";
            el.style.margin = "";
            el.style.padding = "";
            container.style.width = "";
            container.style.overflow = "";
            btn.disabled = false;
            btn.textContent = "Descarca PDF";
            status.textContent = "PDF descarcat cu succes!";
          })
          .catch(function (err) {
            bar.style.display = "flex";
            spacer.style.display = "block";
            el.style.width = "";
            el.style.maxWidth = "";
            el.style.margin = "";
            el.style.padding = "";
            container.style.width = "";
            container.style.overflow = "";
            btn.disabled = false;
            btn.textContent = "Descarca PDF";
            status.textContent = "Eroare: " + err.message;
            console.error("PDF generation failed:", err);
          });
      });
    });
  });
})();
