package com.test;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.io.IOException;
import java.io.PrintWriter;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.ServletException;

/**
 * FALSE POSITIVE: Parameterized query prevents SQL Injection.
 * User input is passed via PreparedStatement, which is safe.
 * Expected: CodeQL should NOT flag this (FP test case).
 */
public class SQLInjectionFP extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        // SOURCE: user-controlled input from HTTP request
        String username = request.getParameter("username");

        PrintWriter out = response.getWriter();
        try {
            Connection conn = DriverManager.getConnection(
                    "jdbc:mysql://localhost:3306/db", "user", "pass");

            // SAFE: PreparedStatement prevents SQL injection
            PreparedStatement ps = conn.prepareStatement(
                    "SELECT * FROM users WHERE username = ?");
            ps.setString(1, username);
            ResultSet rs = ps.executeQuery();

            while (rs.next()) {
                out.println(rs.getString(1));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
