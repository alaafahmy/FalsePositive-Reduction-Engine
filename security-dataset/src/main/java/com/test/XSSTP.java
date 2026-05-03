package com.test;

import java.io.IOException;
import java.io.PrintWriter;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.ServletException;

/**
 * TRUE POSITIVE: Reflected XSS via HttpServletRequest.getParameter()
 * User input is reflected directly into the HTML response without encoding.
 * Expected: CodeQL should flag java/xss
 */
public class XSSTP extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        response.setContentType("text/html");

        // SOURCE: user-controlled input from HTTP request
        String userInput = request.getParameter("name");

        PrintWriter out = response.getWriter();
        // SINK: user input written directly to HTTP response (XSS)
        out.println("<html><body>");
        out.println("<h1>Welcome back!</h1>");
        out.println("<p>User provided: " + userInput + "</p>");
        out.println("</body></html>");
    }
}
