package com.test;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.sql.ResultSet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.ServletException;
import java.io.IOException;
import java.io.PrintWriter;

/**
 * TRUE POSITIVE: SQL Injection via HttpServletRequest.getParameter()
 * User input flows directly into SQL query without sanitization.
 * Expected: CodeQL should flag java/sql-injection
 */
public class SQLInjectionTP extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        // SOURCE: user-controlled input from HTTP request
        String username = request.getParameter("username");

        PrintWriter out = response.getWriter();
        try {
            Connection conn = DriverManager.getConnection(
                    "jdbc:mysql://localhost:3306/db", "user", "pass");
            Statement stmt = conn.createStatement();

            // SINK: user input concatenated directly into SQL query (SQL Injection)
            String query = "SELECT * FROM users WHERE username = '" + username + "'";
            ResultSet rs = stmt.executeQuery(query);

            while (rs.next()) {
                out.println(rs.getString(1));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
