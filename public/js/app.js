var gem_id;
var price;
var event_source;

function showInvoice(invoice) {
  $("#invoice_err").text('');
  $("#pay_req").val(invoice.payment_request);
  $("#pay_link").prop('href', 'lightning:' + invoice.payment_request);
  $("#pay_err").empty();
  new QRious({
    element: document.getElementById('qr'),
    value: invoice.payment_request,
    size: 250
  });
  $('#qr').show();
  $("#pay_req").show();
  $("#step_two").fadeIn('fast');
  $('#loading').fadeOut('fast');
}

function refresh() {
  $("#step_one").show();
  $("#step_two").hide();
  $("#payment").show();
  $("#receipt").hide();
  $("#reset").hide();
  $("#refresh").hide();
  $("#pay_req").val('');
  $("#pay_req_out").val('');
  $("#name").val('');
  $("#url").val('');
  $("#node").val('');
  $('#qr').hide();
  $.get('/status', function(status) {
    var gem = status.recentGems[0];
    if (gem.owner) {
      $("#owner").text(gem.owner);
      if (gem.url)
        $("#owner").prop("href", gem.url);
      else
        $("#owner").removeAttr("href");
    } else
      $("#owner").text("Nobody - You can be the first to own it!");
    $("#owner_count").text(gem._id);
    $("#paid_out_sum").text((status.paidOutSum / 100).toLocaleString());
    price = gem.price;
    $(".price").text((price / 100).toLocaleString() + ' bit' + ((price === 100) ? '' : 's'));
    $(".payout").text((Math.round(1.25 * price) / 100).toLocaleString());
    $("#payout_sats").text(Math.round(1.25 * price));
    $("#new_price").text((Math.round(price * 1.3) / 100).toLocaleString());
    $("#lnd_connection_string").text(status.lndConnectionString);
    gem_id = gem._id;

    var recentGemsHtml = "";
    $.each(status.recentGems.slice(1), function(index, value) {
      recentGemsHtml += "<tr><td>";
      recentGemsHtml += new Date(value.date).toLocaleString() + "</td><td>";
      if (value.url)
        recentGemsHtml += '<a href="' + value.url + '">';
      if (value.owner)
        recentGemsHtml += value.owner;
      if (value.url)
        recentGemsHtml += "</a>";
      recentGemsHtml += "</td><td>" + value.price / 100 + " bits</td><td>";
      if (value.reset)
        recentGemsHtml += '<span class="reset">SOLD & RESET</span>';
      else if (!value.bought)
        recentGemsHtml += '<span class="fail">TIMED OUT</span>';
      else
        recentGemsHtml += 'SOLD!';
      recentGemsHtml += "</td></tr>";
    });
    $("#recent_gems").html(recentGemsHtml);
  });
}
refresh();

$(window).on('unload', function() {
  if (event_source)
    event_source.close();
});

$(document).ready(function() {
  $("#submit").click(function() {
    if (!$("#name").val()) {
      $("#invoice_err").text("Please enter a name");
      return;
    }
    if ($("#url").val()) {
      if (!$("#url").val().startsWith('http')) {
        $("#invoice_err").text("Url must start with http or https");
        return;
      }
    }
    $('#loading').fadeIn('fast');
    $('#step_one').fadeOut('fast');

    var pay_req_out = $("#pay_req_out").val()
    if (pay_req_out.startsWith('lightning://'))
      pay_req_out = pay_req_out.substring(12);
    $.post('/invoice', {
      name: $("#name").val(),
      url: $("#url").val(),
      pay_req_out: pay_req_out,
      gem_id: gem_id
    }, function(invoice) {
      showInvoice(invoice);
      if (!!window.EventSource) {
        event_source = new EventSource('/listen/' + invoice.r_hash);

        event_source.onmessage = function(e) {
          if (e.data == 'settled') {
            $("#payment").hide();
            $("#receipt").show();
          } else if (e.data == 'stale') {
            $("#pay_err").text("Stale payment received");
          } else if (e.data == 'expired') {
            $("#pay_req").hide();
            $("#qr").hide();
            $("#pay_err").text("Gem expired, refresh the page");
          } else if (e.data == 'reset') {
            $("#payment").hide();
            $("#reset").show();
          }
          event_source.close();
          $("#refresh").show();
        };

        event_source.onerror = function(e) {
          if (e.target.readyState == EventSource.CLOSED) {
            $("#pay_err").text("Disconnected from server, refresh the page");
          }
        };
      } else {
        console.log("Your browser doesn't support SSE");
      }
    }).fail(function(response) {
      if (response.responseText)
        $("#invoice_err").text(response.responseText);
      else {
        $("#invoice_err").text("unknown error creating invoice");
      }
      $('#step_one').fadeIn('fast');
      $('#loading').fadeOut('fast');
    });
  });

  $("#refresh").click(function() {
    refresh();
  });
});
