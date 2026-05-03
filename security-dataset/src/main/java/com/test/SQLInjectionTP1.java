package com.test;

/**
 * Classification  : TRUE POSITIVE
 * Vulnerability   : SQL Injection (CWE-089)
 * Why vulnerable  : User input from getParameter("username") is concatenated
 *                   directly into a SQL query string with no escaping or
 *                   parameterisation. An attacker can inject arbitrary SQL.
 * CodeQL expected : SHOULD DETECT  (java/sql-injection)
 */
import java.io.IOException;
import java.io.PrintWriter;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class SQLInjectionTP1 extends HttpServlet {

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        // SOURCE — direct HTTP parameter, fully user-controlled
        String username = req.getParameter("username");

        PrintWriter out = resp.getWriter();
        try {
            Connection conn = DriverManager.getConnection(
                    "jdbc:mysql://localhost:3306/appdb", "root", "secret");
            Statement stmt = conn.createStatement();

            // SINK — raw concatenation, no parameterisation
            String sql = "SELECT id, email FROM users WHERE username = '" + username + "'";
            ResultSet rs = stmt.executeQuery(sql);

            while (rs.next()) {
                out.println(rs.getString("email"));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
